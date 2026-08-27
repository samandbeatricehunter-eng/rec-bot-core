// Scaffolding for reading the Madden 27 live scorebug out of a video frame. Not wired into any
// route or job yet -- see docs/scorebug-ocr-regions.md for the calibration behind the crop
// regions and stress-test.ts for how this gets exercised against real highlight frames.
import sharp from "sharp";
import { recognizeScorebugField } from "./scorebug-tesseract-pool.js";
import { flattenPageWords } from "../box-score/box-score.parser.ocr.js";
import { SCOREBUG_REGIONS, regionToPixels, type FractionalRegion, type ScorebugFieldName } from "./scorebug-regions.js";

export type ScorebugFieldResult = { rawText: string; confidence: number };

export type ScorebugFrameResult = {
  isLiveScorebug: boolean;
  awayScore: number | null;
  homeScore: number | null;
  quarter: number | "OT" | null;
  gameClock: string | null; // "M:SS", already zero-padded
  playClock: number | null;
  downDistance: { down: number; distance: number } | "kickoff" | null;
  yardLine: number | null;
  // ▲ = "up" (point up, wide base at bottom), ▼ = "down" -- raw shape only. Which one means
  // "own territory" vs. "opponent territory" isn't confirmed yet (see docs/scorebug-ocr-regions.md);
  // combine with yardLine + which team has the ball to derive actual field position downstream.
  yardLineDirection: "up" | "down" | "unknown";
  possession: "neutral" | "left" | "right" | "unknown";
  raw: Record<ScorebugFieldName, ScorebugFieldResult>;
};

// ─── Per-region crop + OCR ────────────────────────────────────────────────────

/** Mirrors box-score.parser.ocr.ts's "default" preprocessing (grayscale, normalise, threshold,
 * negate -> light text on dark background reads best), plus a 3x upscale since these crops are
 * much smaller than a full box-score screenshot and Tesseract needs the extra resolution. */
async function preprocessFieldCrop(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const width = Math.max(1, meta.width ?? 1);
  const height = Math.max(1, meta.height ?? 1);
  return sharp(buffer)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .grayscale()
    .normalise()
    .threshold(120)
    .negate()
    .resize(width * 3, height * 3, { fit: "fill" })
    .png()
    .toBuffer();
}

async function ocrRegion(frameBuffer: Buffer, fieldName: ScorebugFieldName, frameWidth: number, frameHeight: number): Promise<ScorebugFieldResult> {
  const pixels = regionToPixels(SCOREBUG_REGIONS[fieldName], frameWidth, frameHeight);
  const crop = await sharp(frameBuffer).extract(pixels).toBuffer();
  const processed = await preprocessFieldCrop(crop);
  const result = await recognizeScorebugField(processed, undefined, { blocks: true });
  const words = flattenPageWords(result.data);
  if (!words.length) return { rawText: "", confidence: 0 };
  const rawText = words.map((w) => w.text.trim()).filter(Boolean).join(" ");
  const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
  return { rawText, confidence };
}

// ─── Field normalizers ────────────────────────────────────────────────────────
// All tolerant of common OCR digit confusions (O/o -> 0, l/I -> 1, S -> 5) since none of these
// fields have a whitelist constraint applied at the Tesseract layer (the box-score module's own
// established pattern -- see box-score.parser.ocr.ts -- is to post-filter with regex rather
// than fight the shared worker pool over per-job character whitelists).
function normalizeDigits(text: string): string {
  return text.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/[sS]/g, "5");
}

function parseScoreDigits(text: string): number | null {
  const digits = normalizeDigits(text).match(/\d{1,3}/);
  return digits ? Number(digits[0]) : null;
}

const QUARTER_PATTERN = /(\d)\s*(ST|ND|RD|TH)/i;
function parseQuarter(text: string): number | "OT" | null {
  if (/OT/i.test(text)) return "OT";
  const match = QUARTER_PATTERN.exec(text);
  if (!match) return null;
  const num = Number(match[1]);
  return num >= 1 && num <= 4 ? num : null;
}

function parseGameClock(text: string): string | null {
  const normalized = normalizeDigits(text);
  const match = normalized.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (minutes > 15 || seconds > 59) return null; // a quarter is at most 15 real minutes
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parsePlayClock(text: string): number | null {
  const normalized = normalizeDigits(text).replace(/[:.]/g, "");
  const match = normalized.match(/\d{1,2}/);
  if (!match) return null;
  const value = Number(match[0]);
  return value >= 0 && value <= 40 ? value : null;
}

function parseDownDistance(text: string): { down: number; distance: number } | "kickoff" | null {
  if (/KICK/i.test(text)) return "kickoff";
  const normalized = normalizeDigits(text);
  const match = normalized.match(/(\d)\D+(\d{1,2})/);
  if (!match) return null;
  const down = Number(match[1]);
  const distance = Number(match[2]);
  if (down < 1 || down > 4) return null;
  return { down, distance };
}

function parseYardLine(text: string): number | null {
  // Direction (own vs. opponent territory, the ▲/▼ glyph) isn't handled yet -- see
  // docs/scorebug-ocr-regions.md's "not yet solved" note. This returns the number only.
  // Takes the LAST 1-2 digit run, not the first -- a misread triangle glyph or border pixel
  // commonly OCRs as a stray leading digit (e.g. real "39" reading as "339"), which a
  // first-match regex would wrongly parse as "33".
  const allDigitRuns = normalizeDigits(text).match(/\d+/g);
  if (!allDigitRuns?.length) return null;
  const lastRun = allDigitRuns[allDigitRuns.length - 1];
  const value = Number(lastRun.slice(-2));
  return value >= 0 && value <= 50 ? value : null;
}

// ─── Shape classification (not OCR) ───────────────────────────────────────────
// Shared by the possession glyph (x / ◀ / ▶) and the yard-line direction triangle (▲ / ▼) --
// both are small glyphs distinguished by which half of their bounding box the ink mass
// concentrates in, not by character shape a text OCR engine would recognize reliably at this
// size. A triangle's mass concentrates toward its flat base and away from its point, so
// comparing one half of the thresholded crop against the other cheaply tells a symmetric glyph
// ("x", or "unknown"/blank) from a lopsided one (a triangle, heavier on the side opposite the
// point).
async function computeMassImbalance(frameBuffer: Buffer, region: FractionalRegion, frameWidth: number, frameHeight: number, axis: "horizontal" | "vertical"): Promise<number | null> {
  const pixels = regionToPixels(region, frameWidth, frameHeight);
  const crop = sharp(frameBuffer).extract(pixels).flatten({ background: { r: 0, g: 0, b: 0 } }).grayscale().normalise().threshold(120);
  const { data, info } = await crop.raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width < 2 || height < 2) return null;

  let firstHalfMass = 0;
  let secondHalfMass = 0;
  const midpoint = axis === "horizontal" ? Math.floor(width / 2) : Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = data[y * width + x] ?? 0;
      // These glyphs are dark ink on a light scorebug background -- after threshold() (no
      // negate here, unlike the OCR preprocessing path), the glyph itself is the DARK pixels,
      // not the bright ones.
      const ink = value < 128 ? 1 : 0;
      const inFirstHalf = axis === "horizontal" ? x < midpoint : y < midpoint;
      if (inFirstHalf) firstHalfMass += ink; else secondHalfMass += ink;
    }
  }
  const totalMass = firstHalfMass + secondHalfMass;
  if (totalMass < 4) return null; // essentially blank crop, region likely misaligned
  return (secondHalfMass - firstHalfMass) / totalMass;
}

async function classifyPossessionGlyph(frameBuffer: Buffer, frameWidth: number, frameHeight: number): Promise<"neutral" | "left" | "right" | "unknown"> {
  const imbalance = await computeMassImbalance(frameBuffer, SCOREBUG_REGIONS.possessionGlyph, frameWidth, frameHeight, "horizontal");
  if (imbalance === null) return "unknown";
  if (Math.abs(imbalance) < 0.15) return "neutral"; // roughly symmetric -> "x"
  // More mass on the right half means the point (the empty/narrow side) is on the left ->
  // triangle points left, toward the away score.
  return imbalance > 0 ? "left" : "right";
}

/** ▲ (point up, base at bottom) -> more mass in the bottom half. ▼ (point down, base at top) ->
 * more mass in the top half. */
async function classifyYardLineDirection(frameBuffer: Buffer, frameWidth: number, frameHeight: number): Promise<"up" | "down" | "unknown"> {
  const imbalance = await computeMassImbalance(frameBuffer, SCOREBUG_REGIONS.yardLineDirection, frameWidth, frameHeight, "vertical");
  if (imbalance === null) return "unknown";
  if (Math.abs(imbalance) < 0.15) return "unknown"; // too symmetric to confidently call a direction
  return imbalance > 0 ? "up" : "down"; // more mass in the bottom half -> base at bottom -> points up
}

// ─── Frame classification ─────────────────────────────────────────────────────

/** Rough v1 heuristic: the pre-snap play-call screen has no readable quarter+clock in these
 * regions at all (they live elsewhere on that screen), so treat "neither parsed" as "this isn't
 * the live scorebug" rather than trying to force a read. Needs validation against more samples
 * of the play-call screen specifically -- see docs/scorebug-ocr-regions.md. */
function isLikelyLiveScorebug(quarter: number | "OT" | null, gameClock: string | null): boolean {
  return quarter !== null || gameClock !== null;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export async function parseScorebugFrame(imageBuffer: Buffer): Promise<ScorebugFrameResult> {
  const meta = await sharp(imageBuffer).metadata();
  const frameWidth = meta.width ?? 1920;
  const frameHeight = meta.height ?? 1080;

  const shapeClassifiedFields: ScorebugFieldName[] = ["possessionGlyph", "yardLineDirection"];
  const fieldNames = Object.keys(SCOREBUG_REGIONS) as ScorebugFieldName[];
  const raw = {} as Record<ScorebugFieldName, ScorebugFieldResult>;
  for (const fieldName of fieldNames) {
    if (shapeClassifiedFields.includes(fieldName)) continue;
    raw[fieldName] = await ocrRegion(imageBuffer, fieldName, frameWidth, frameHeight);
  }
  for (const fieldName of shapeClassifiedFields) raw[fieldName] = { rawText: "", confidence: 0 };

  const quarter = parseQuarter(raw.quarter.rawText);
  const gameClock = parseGameClock(raw.gameClock.rawText);
  const [possession, yardLineDirection] = await Promise.all([
    classifyPossessionGlyph(imageBuffer, frameWidth, frameHeight),
    classifyYardLineDirection(imageBuffer, frameWidth, frameHeight),
  ]);

  return {
    isLiveScorebug: isLikelyLiveScorebug(quarter, gameClock),
    awayScore: parseScoreDigits(raw.awayScore.rawText),
    homeScore: parseScoreDigits(raw.homeScore.rawText),
    quarter,
    gameClock,
    playClock: parsePlayClock(raw.playClock.rawText),
    downDistance: parseDownDistance(raw.downDistance.rawText),
    yardLine: parseYardLine(raw.yardLine.rawText),
    yardLineDirection,
    possession,
    raw,
  };
}
