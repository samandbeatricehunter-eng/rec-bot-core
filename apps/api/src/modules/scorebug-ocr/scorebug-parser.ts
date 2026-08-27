// Scaffolding for reading the Madden 27 live scorebug out of a video frame. Not wired into any
// route or job yet -- see docs/scorebug-ocr-regions.md for the calibration behind the crop
// regions and stress-test.ts for how this gets exercised against real highlight frames.
import sharp from "sharp";
import { recognizeScorebugField, type ScorebugWhitelistKind } from "./scorebug-tesseract-pool.js";
import { flattenPageWords } from "../box-score/box-score.parser.ocr.js";
import { SCOREBUG_REGIONS, SCOREBUG_REGIONS_NO_TICKER, regionToPixels, type FractionalRegion, type ScorebugFieldName } from "./scorebug-regions.js";

type ScorebugRegionSet = Record<ScorebugFieldName, FractionalRegion>;

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

// Mirrors box-score.parser.ocr.ts's variant naming/intent: "default" is a plain global
// threshold (fast, right most of the time); "clahe" recovers low-contrast text a flat threshold
// crushes (e.g. the dimmer gray quarter/down-distance labels vs. the bright-white clock, or a
// motion-blurred frame); "lowThreshold" catches text that's slightly darker overall than
// "default" assumes. All three end in the same negate()'d light-on-dark polarity Tesseract
// reads best, plus a 3x upscale since these crops are far smaller than a full box-score capture.
type FieldPreprocessVariant = "default" | "clahe" | "lowThreshold";

async function preprocessFieldCrop(buffer: Buffer, variant: FieldPreprocessVariant): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const width = Math.max(1, meta.width ?? 1);
  const height = Math.max(1, meta.height ?? 1);
  let pipeline = sharp(buffer).flatten({ background: { r: 0, g: 0, b: 0 } }).grayscale();
  if (variant === "clahe") {
    pipeline = pipeline.clahe({ width: Math.max(8, Math.floor(width / 2)), height: Math.max(8, Math.floor(height / 2)), maxSlope: 3 }).normalise();
  } else if (variant === "lowThreshold") {
    pipeline = pipeline.normalise().threshold(85);
  } else {
    pipeline = pipeline.normalise().threshold(120);
  }
  return pipeline.negate().resize(width * 3, height * 3, { fit: "fill" }).png().toBuffer();
}

// Only quarter and down/distance can legitimately contain letters ("4TH", "KICKOFF"); every
// other field is digits and a separator only. See scorebug-tesseract-pool.ts for why this needs
// to be two separate whitelists/pools rather than one shared one.
const FIELD_WHITELIST_KIND: Record<ScorebugFieldName, ScorebugWhitelistKind> = {
  awayScore: "numeric",
  possessionGlyph: "numeric", // unused (shape-classified, not OCR'd), kept for type completeness
  homeScore: "numeric",
  quarter: "label",
  gameClock: "numeric",
  playClock: "numeric",
  downDistance: "label",
  yardLineDirection: "numeric", // unused (shape-classified, not OCR'd), kept for type completeness
  yardLine: "numeric",
};

async function ocrWithVariant(crop: Buffer, variant: FieldPreprocessVariant, whitelistKind: ScorebugWhitelistKind): Promise<ScorebugFieldResult> {
  const processed = await preprocessFieldCrop(crop, variant);
  const result = await recognizeScorebugField(whitelistKind, processed, undefined, { blocks: true });
  const words = flattenPageWords(result.data);
  if (!words.length) return { rawText: "", confidence: 0 };
  const rawText = words.map((w) => w.text.trim()).filter(Boolean).join(" ");
  const confidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
  return { rawText, confidence };
}

// Every scorebug field is fundamentally digit-based (a score, a clock, an ordinal, a down &
// distance) -- accepting "first non-empty text" from a low-quality fallback variant let
// confident-looking garbage (e.g. "Ds") win over a correctly-empty result. Confirmed directly:
// this regressed the one frame with fully-known ground truth (home score `0` -> wrong `"Ds"`)
// the moment the CLAHE/lowThreshold fallback chain was added. Requiring at least one digit
// closes that specific hole without losing the fallback's real gains elsewhere.
function looksLikeRealField(rawText: string): boolean {
  // "KICKOFF" is a legitimate real down/distance value with zero digits -- must not get treated
  // as noise, or a correct read gets discarded by this exact check.
  return /\d/.test(rawText) || /KICK/i.test(rawText);
}

/** Tries "default" first (cheapest, right most of the time); only pays for the CLAHE/
 * low-threshold variants when default comes back without a plausible (digit-containing)
 * result. Keeps the common case at 1x OCR cost instead of 3x. */
async function ocrRegion(frameBuffer: Buffer, regions: ScorebugRegionSet, fieldName: ScorebugFieldName, frameWidth: number, frameHeight: number): Promise<ScorebugFieldResult> {
  const pixels = regionToPixels(regions[fieldName], frameWidth, frameHeight);
  const crop = await sharp(frameBuffer).extract(pixels).toBuffer();
  const whitelistKind = FIELD_WHITELIST_KIND[fieldName];
  const attempt = await ocrWithVariant(crop, "default", whitelistKind);
  if (looksLikeRealField(attempt.rawText)) return attempt;
  const clahe = await ocrWithVariant(crop, "clahe", whitelistKind);
  if (looksLikeRealField(clahe.rawText)) return clahe;
  const lowThreshold = await ocrWithVariant(crop, "lowThreshold", whitelistKind);
  if (looksLikeRealField(lowThreshold.rawText)) return lowThreshold;
  // None of the three produced anything digit-shaped -- return empty rather than whichever
  // variant's non-digit noise happened to run last, so a caller can tell "no data" apart from
  // "data, just unparsed."
  return { rawText: "", confidence: 0 };
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
  // Takes the FIRST digit run as down and the LAST as distance, not "the first two digit runs"
  // -- a misread ordinal letter (e.g. "RD" -> "0") commonly inserts a spurious middle digit run
  // between the real down and the real distance (confirmed: "3RD & 24" OCR'd as "3R0&249" was
  // parsing as down=3, distance=0 -- the misread "D"->"0" -- instead of the real distance "24").
  const normalized = normalizeDigits(text);
  const digitRuns = normalized.match(/\d+/g);
  if (!digitRuns || digitRuns.length < 2) return null;
  const down = Number(digitRuns[0]);
  const distance = Number(digitRuns[digitRuns.length - 1].slice(-2));
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

  // Polarity isn't fixed -- the primary framing's score area is a light background with a dark
  // glyph, but the no-ticker framing's is a solid black background with a white/light glyph.
  // The glyph is always the minority of pixels in a small, mostly-background crop after
  // threshold(), regardless of which absolute brightness it is, so count both polarities first
  // and treat whichever is rarer as ink.
  let darkCount = 0;
  let lightCount = 0;
  for (let i = 0; i < data.length; i++) {
    if ((data[i] ?? 0) < 128) darkCount++; else lightCount++;
  }
  const inkIsDark = darkCount <= lightCount;

  let firstHalfMass = 0;
  let secondHalfMass = 0;
  const midpoint = axis === "horizontal" ? Math.floor(width / 2) : Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = data[y * width + x] ?? 0;
      const isDark = value < 128;
      const ink = isDark === inkIsDark ? 1 : 0;
      const inFirstHalf = axis === "horizontal" ? x < midpoint : y < midpoint;
      if (inFirstHalf) firstHalfMass += ink; else secondHalfMass += ink;
    }
  }
  const totalMass = firstHalfMass + secondHalfMass;
  if (totalMass < 4) return null; // essentially blank crop, region likely misaligned
  return (secondHalfMass - firstHalfMass) / totalMass;
}

async function classifyPossessionGlyph(frameBuffer: Buffer, regions: ScorebugRegionSet, frameWidth: number, frameHeight: number): Promise<"neutral" | "left" | "right" | "unknown"> {
  const imbalance = await computeMassImbalance(frameBuffer, regions.possessionGlyph, frameWidth, frameHeight, "horizontal");
  if (imbalance === null) return "unknown";
  if (Math.abs(imbalance) < 0.15) return "neutral"; // roughly symmetric -> "x"
  // More mass on the right half means the point (the empty/narrow side) is on the left ->
  // triangle points left, toward the away score.
  return imbalance > 0 ? "left" : "right";
}

/** ▲ (point up, base at bottom) -> more mass in the bottom half. ▼ (point down, base at top) ->
 * more mass in the top half. */
async function classifyYardLineDirection(frameBuffer: Buffer, regions: ScorebugRegionSet, frameWidth: number, frameHeight: number): Promise<"up" | "down" | "unknown"> {
  const imbalance = await computeMassImbalance(frameBuffer, regions.yardLineDirection, frameWidth, frameHeight, "vertical");
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

async function parseScorebugFrameWithRegions(imageBuffer: Buffer, regions: ScorebugRegionSet, frameWidth: number, frameHeight: number): Promise<ScorebugFrameResult> {
  const shapeClassifiedFields: ScorebugFieldName[] = ["possessionGlyph", "yardLineDirection"];
  const fieldNames = Object.keys(regions) as ScorebugFieldName[];
  const raw = {} as Record<ScorebugFieldName, ScorebugFieldResult>;
  for (const fieldName of fieldNames) {
    if (shapeClassifiedFields.includes(fieldName)) continue;
    raw[fieldName] = await ocrRegion(imageBuffer, regions, fieldName, frameWidth, frameHeight);
  }
  for (const fieldName of shapeClassifiedFields) raw[fieldName] = { rawText: "", confidence: 0 };

  const quarter = parseQuarter(raw.quarter.rawText);
  const gameClock = parseGameClock(raw.gameClock.rawText);
  const [possession, yardLineDirection] = await Promise.all([
    classifyPossessionGlyph(imageBuffer, regions, frameWidth, frameHeight),
    classifyYardLineDirection(imageBuffer, regions, frameWidth, frameHeight),
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

/** Number of fields that actually parsed to something -- used to pick the better-fitting
 * framing when trying both, not as a real confidence score. */
function nonNullFieldCount(result: ScorebugFrameResult): number {
  let count = 0;
  if (result.awayScore !== null) count++;
  if (result.homeScore !== null) count++;
  if (result.quarter !== null) count++;
  if (result.gameClock !== null) count++;
  if (result.playClock !== null) count++;
  if (result.downDistance !== null) count++;
  if (result.yardLine !== null) count++;
  if (result.yardLineDirection !== "unknown") count++;
  if (result.possession !== "unknown") count++;
  return count;
}

/** Uses the "ticker present" framing, matching every calibration sample gathered so far. */
export async function parseScorebugFrame(imageBuffer: Buffer): Promise<ScorebugFrameResult> {
  const meta = await sharp(imageBuffer).metadata();
  const frameWidth = meta.width ?? 1920;
  const frameHeight = meta.height ?? 1080;
  return parseScorebugFrameWithRegions(imageBuffer, SCOREBUG_REGIONS, frameWidth, frameHeight);
}

/** Tries both known framings (ticker present / pre-snap wide shot with no ticker) and returns
 * whichever parsed more fields successfully. Costs roughly 2x the OCR work of
 * parseScorebugFrame -- fine for calibration/backfill, but a real-time tracker should instead
 * detect the framing once per stream (or per shot change) and stick with it, not re-guess every
 * frame. See docs/scorebug-ocr-regions.md's "no-ticker framing" section. */
export async function parseScorebugFrameAuto(imageBuffer: Buffer): Promise<ScorebugFrameResult & { framing: "ticker" | "no_ticker" }> {
  const meta = await sharp(imageBuffer).metadata();
  const frameWidth = meta.width ?? 1920;
  const frameHeight = meta.height ?? 1080;
  const [ticker, noTicker] = await Promise.all([
    parseScorebugFrameWithRegions(imageBuffer, SCOREBUG_REGIONS, frameWidth, frameHeight),
    parseScorebugFrameWithRegions(imageBuffer, SCOREBUG_REGIONS_NO_TICKER, frameWidth, frameHeight),
  ]);
  return nonNullFieldCount(noTicker) > nonNullFieldCount(ticker)
    ? { ...noTicker, framing: "no_ticker" }
    : { ...ticker, framing: "ticker" };
}
