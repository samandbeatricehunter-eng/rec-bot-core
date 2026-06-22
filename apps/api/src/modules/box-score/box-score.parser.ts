import sharp from "sharp";
import Tesseract, { type Page as TesseractPage } from "tesseract.js";

// Singleton worker — initialized once, reused across requests.
let _worker: Tesseract.Worker | null = null;
let _workerInitializing: Promise<Tesseract.Worker> | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (_worker) return _worker;
  if (_workerInitializing) return _workerInitializing;
  _workerInitializing = Tesseract.createWorker("eng").then((w) => {
    _worker = w;
    _workerInitializing = null;
    return w;
  });
  return _workerInitializing;
}

export async function terminateTesseractWorker() {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type NormalizedWord = {
  text: string;
  confidence: number;
  x: number;   // center x, 0–1
  y: number;   // center y, 0–1
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

export type ParsedScore = {
  team1Abbr: string;   // top team in scoreboard
  team2Abbr: string;   // bottom team in scoreboard
  team1Score: number;
  team2Score: number;
  team1Quarters: number[];  // [q1, q2, q3, q4, ot]
  team2Quarters: number[];
};

export type MatchVia = "exact" | "alias" | "fuzzy";

export type ParsedStat = {
  key: string;
  team1: string;
  team2: string;
  rawLabel: string;
  matchedVia: MatchVia;
};

// raw_label (normalized) → canonical stat key, learned from approved parses.
export type LabelAliases = Record<string, string>;

export type ParsedBoxScore = {
  score: ParsedScore | null;
  stats: Record<string, { team1: string; team2: string }>;
  warnings: string[];
  // Human-readable names of required fields that could not be read. Empty = complete.
  missingRequired: string[];
  // canonical key → normalized raw label, for fuzzy matches only (learning corpus).
  labelSamples: Record<string, string>;
};

// ─── Known stat labels (lowercase key → canonical key) ──────────────────────

const STAT_LABEL_MAP: Record<string, string> = {
  "off yards gained": "off_yards_gained",
  "off rush yards": "off_rush_yards",
  "off pass yards": "off_pass_yards",
  "off first down": "off_first_down",
  "punt return yards": "punt_return_yards",
  "kick return yards": "kick_return_yards",
  "total yards gained": "total_yards_gained",
  "turnovers": "turnovers",
  "third down conversions": "third_down_conversions",
  "fourth down conversions": "fourth_down_conversions",
  "two point conversions": "two_point_conversions",
  "red zone off percentage": "red_zone_off_percentage",
  "red zone off td": "red_zone_off_td",
  "red zone off fg": "red_zone_off_fg",
  "penalty yards": "penalty_yards",
  "time of possession": "time_of_possession",
};

const ALL_STAT_KEYS = new Set(Object.values(STAT_LABEL_MAP));

// ─── Required fields for an accepted submission ────────────────────────────────
// Decision: score + quarter scores + a key-stats subset. Anything outside this set
// is captured best-effort and never blocks the submitter.

export const REQUIRED_STAT_KEYS = [
  "off_yards_gained",
  "off_rush_yards",
  "off_pass_yards",
  "off_first_down",
  "punt_return_yards",
  "kick_return_yards",
  "turnovers",
  "red_zone_off_percentage",
] as const;

const FIELD_DISPLAY_NAMES: Record<string, string> = {
  off_yards_gained: "Off Yards Gained",
  off_rush_yards: "Off Rush Yards",
  off_pass_yards: "Off Pass Yards",
  off_first_down: "Off First Downs",
  punt_return_yards: "Punt Return Yards",
  kick_return_yards: "Kick Return Yards",
  turnovers: "Turnovers",
  red_zone_off_percentage: "Red Zone Off %",
  total_yards_gained: "Total Yards Gained",
  time_of_possession: "Time of Possession",
  third_down_conversions: "Third Down Conversions",
  fourth_down_conversions: "Fourth Down Conversions",
  two_point_conversions: "Two Point Conversions",
  red_zone_off_td: "Red Zone Off TD",
  red_zone_off_fg: "Red Zone Off FG",
  penalty_yards: "Penalty Yards",
};

function hasValue(v: { team1: string; team2: string } | undefined): boolean {
  return !!v && (v.team1?.trim().length > 0 || v.team2?.trim().length > 0);
}

function computeMissingRequired(
  score: ParsedScore | null,
  statsMap: Record<string, { team1: string; team2: string }>,
): string[] {
  const missing: string[] = [];
  if (!score) {
    missing.push("Final score / scoreboard");
  } else if (score.team1Quarters.length === 0 && score.team2Quarters.length === 0) {
    missing.push("Quarter-by-quarter scores");
  }
  for (const key of REQUIRED_STAT_KEYS) {
    if (!hasValue(statsMap[key])) missing.push(FIELD_DISPLAY_NAMES[key] ?? key);
  }
  return missing;
}

// ─── Image preprocessing ─────────────────────────────────────────────────────

async function preprocessImage(buffer: Buffer): Promise<{ processed: Buffer; width: number; height: number }> {
  // Resize to max 1920px wide so coordinates are consistent regardless of capture resolution.
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  const targetWidth = Math.min(originalWidth, 1920);

  const processed = await sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: true })
    .grayscale()
    .normalise()            // auto-stretch contrast
    .threshold(100)         // >100 stays white (text), rest becomes black
    .negate()               // flip to black-text-on-white for Tesseract
    .png()
    .toBuffer();

  const processedMeta = await sharp(processed).metadata();
  return { processed, width: processedMeta.width!, height: processedMeta.height! };
}

// ─── Word extraction ─────────────────────────────────────────────────────────

function flattenPageWords(page: TesseractPage): Tesseract.Word[] {
  const out: Tesseract.Word[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        out.push(...line.words);
      }
    }
  }
  return out;
}

async function extractNormalizedWords(buffer: Buffer): Promise<{ words: NormalizedWord[]; width: number; height: number }> {
  const { processed, width, height } = await preprocessImage(buffer);
  const worker = await getWorker();
  // blocks: true is required in v7 to populate the nested block/paragraph/line/word structure
  const result = await worker.recognize(processed, undefined, { blocks: true });

  const rawWords = flattenPageWords(result.data);

  const words: NormalizedWord[] = rawWords
    .filter((w) => w.confidence > 25 && w.text.trim().length > 0)
    .map((w) => ({
      text: w.text.trim(),
      confidence: w.confidence,
      x: (w.bbox.x0 + w.bbox.x1) / 2 / width,
      y: (w.bbox.y0 + w.bbox.y1) / 2 / height,
      x0: w.bbox.x0 / width,
      x1: w.bbox.x1 / width,
      y0: w.bbox.y0 / height,
      y1: w.bbox.y1 / height,
    }));

  return { words, width, height };
}

// ─── Row grouping ─────────────────────────────────────────────────────────────

function groupIntoRows(words: NormalizedWord[], yTolerance = 0.04): NormalizedWord[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const rows: NormalizedWord[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lastRow = rows[rows.length - 1];
    const lastY = lastRow.reduce((s, w) => s + w.y, 0) / lastRow.length;
    if (Math.abs(sorted[i].y - lastY) < yTolerance) {
      lastRow.push(sorted[i]);
    } else {
      rows.push([sorted[i]]);
    }
  }

  return rows;
}

// ─── Score header parsing ────────────────────────────────────────────────────

// The score block sits in the top ~38% of the image.
const HEADER_Y_MAX = 0.38;

function parseScoreHeader(words: NormalizedWord[]): ParsedScore | null {
  const headerWords = words.filter((w) => w.y < HEADER_Y_MAX);
  const rows = groupIntoRows(headerWords, 0.04);

  // Find rows that have numeric content (team score rows), at least 3 numbers each.
  const teamRows = rows.filter((row) => {
    const nums = row.filter((w) => /^\d+$/.test(w.text));
    return nums.length >= 3;
  });

  if (teamRows.length < 2) return null;

  const parseRow = (row: NormalizedWord[]) => {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    // Team abbreviation: 2–3 uppercase letters; pick the leftmost match
    const abbrWord = sorted.find((w) => /^[A-Z]{2,4}$/.test(w.text) && w.confidence > 40);
    const abbr = abbrWord?.text ?? sorted.find((w) => /^[A-Za-z]{2,4}$/.test(w.text))?.text?.toUpperCase() ?? "???";
    // Numbers: all numeric words sorted left-to-right
    const numbers = sorted.filter((w) => /^\d+$/.test(w.text)).map((w) => parseInt(w.text, 10));
    // Last number is the total; preceding numbers are quarters
    const total = numbers.length > 0 ? numbers[numbers.length - 1] : 0;
    const quarters = numbers.slice(0, -1);
    return { abbr, total, quarters };
  };

  const t1 = parseRow(teamRows[0]);
  const t2 = parseRow(teamRows[1]);

  return {
    team1Abbr: t1.abbr,
    team2Abbr: t2.abbr,
    team1Score: t1.total,
    team2Score: t2.total,
    team1Quarters: t1.quarters,
    team2Quarters: t2.quarters,
  };
}

// ─── Stats table parsing ──────────────────────────────────────────────────────

// Stats occupy the bottom ~65% of the image.
const STATS_Y_MIN = 0.35;
// Column thresholds (relative to image width).
const LEFT_VAL_X_MAX = 0.18;
const RIGHT_VAL_X_MIN = 0.82;
const CENTER_X_MIN = 0.18;
const CENTER_X_MAX = 0.82;
const ROW_Y_TOLERANCE = 0.04;

function cleanStatValue(raw: string): string {
  return raw
    .replace(/^[^0-9:]+/, "")  // strip leading non-digit/colon (▶ arrows, spaces)
    .replace(/[^0-9:]+$/, "")  // strip trailing non-digit/colon
    .trim();
}

function normalizeLabel(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchStatLabel(normalized: string, aliases: LabelAliases): { key: string; via: MatchVia } | null {
  if (STAT_LABEL_MAP[normalized]) return { key: STAT_LABEL_MAP[normalized], via: "exact" };

  // Learned alias from a previously-approved parse — treat as an exact hit.
  if (aliases[normalized]) return { key: aliases[normalized], via: "alias" };

  // Partial match: known label contained in OCR output, or OCR output contained in known label.
  for (const [label, key] of Object.entries(STAT_LABEL_MAP)) {
    if (normalized.length >= 6 && label.includes(normalized)) return { key, via: "fuzzy" };
    if (label.length >= 6 && normalized.includes(label)) return { key, via: "fuzzy" };
    // First-word match for single-word labels (e.g. "Turnovers")
    if (label.split(" ").length === 1 && normalized.startsWith(label)) return { key, via: "fuzzy" };
  }
  return null;
}

function findValueNearY(candidates: NormalizedWord[], targetY: number): string {
  const nearby = candidates.filter((w) => Math.abs(w.y - targetY) < ROW_Y_TOLERANCE);
  if (nearby.length === 0) return "";
  nearby.sort((a, b) => Math.abs(a.y - targetY) - Math.abs(b.y - targetY));
  return cleanStatValue(nearby.map((w) => w.text).join(" "));
}

function parseStatRows(words: NormalizedWord[], aliases: LabelAliases): ParsedStat[] {
  const statZone = words.filter((w) => w.y >= STATS_Y_MIN);

  const leftVals  = statZone.filter((w) => w.x < LEFT_VAL_X_MAX);
  const rightVals = statZone.filter((w) => w.x > RIGHT_VAL_X_MIN);
  const center    = statZone.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX);

  // Group center words into label rows
  const centerRows = groupIntoRows(center, ROW_Y_TOLERANCE);

  const stats: ParsedStat[] = [];
  const seenKeys = new Set<string>();

  for (const row of centerRows) {
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const normalized = normalizeLabel(sortedRow.map((w) => w.text).join(" "));
    const rowY = sortedRow.reduce((s, w) => s + w.y, 0) / sortedRow.length;
    const match = matchStatLabel(normalized, aliases);

    if (!match || seenKeys.has(match.key)) continue;
    seenKeys.add(match.key);

    const team1Val = findValueNearY(leftVals, rowY);
    const team2Val = findValueNearY(rightVals, rowY);

    stats.push({ key: match.key, team1: team1Val, team2: team2Val, rawLabel: normalized, matchedVia: match.via });
  }

  return stats;
}

// ─── Image fetch helper ───────────────────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// ─── Main parse entry point ───────────────────────────────────────────────────

async function parseImage(buffer: Buffer, aliases: LabelAliases): Promise<{ score: ParsedScore | null; stats: ParsedStat[]; warnings: string[] }> {
  const warnings: string[] = [];
  let score: ParsedScore | null = null;
  let stats: ParsedStat[] = [];

  try {
    const { words } = await extractNormalizedWords(buffer);
    score = parseScoreHeader(words);
    if (!score) warnings.push("Could not parse score header from this image.");
    stats = parseStatRows(words, aliases);
  } catch (err) {
    warnings.push(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { score, stats, warnings };
}

// The single default Box Score screenshot carries every required field. Still
// accepts more than one image — a submitter can re-post when the OCR misses a
// field — and merges them, preferring the first non-empty value found per key.
export async function parseBoxScoreImages(imageUrls: string[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));
  const results = await Promise.all(buffers.map((b) => parseImage(b, aliases)));

  // Score: first image that yields one wins (page 1 is primary, but accept any).
  const score = results.map((r) => r.score).find((s): s is ParsedScore => s != null) ?? null;

  // Capture fuzzy-matched raw labels so an approval can promote them to aliases.
  const labelSamples: Record<string, string> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      if (stat.matchedVia === "fuzzy" && stat.rawLabel && !(stat.key in labelSamples)) {
        labelSamples[stat.key] = stat.rawLabel;
      }
    }
  }

  // Merge stats across all images. A later image can fill in a key that an
  // earlier image either missed entirely or read with an empty value.
  const statsMap: Record<string, { team1: string; team2: string }> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      const candidate = { team1: stat.team1, team2: stat.team2 };
      if (!hasValue(statsMap[stat.key]) && hasValue(candidate)) {
        statsMap[stat.key] = candidate;
      } else if (!(stat.key in statsMap)) {
        statsMap[stat.key] = candidate; // keep an (empty) placeholder so the key is known
      }
    }
  }

  // Derive Total Yards Gained = Off Yards + Punt Return + Kick Return when it
  // wasn't read directly (it lives on the second screenshot we no longer require).
  if (!hasValue(statsMap["total_yards_gained"])) {
    const off = statsMap["off_yards_gained"];
    const pr = statsMap["punt_return_yards"];
    const kr = statsMap["kick_return_yards"];
    const sum = (a?: string, b?: string, c?: string): string => {
      const nums = [a, b, c].map((v) => parseInt(v ?? "", 10));
      if (nums.some((n) => isNaN(n))) return "";
      return String(nums.reduce((s, n) => s + n, 0));
    };
    if (hasValue(off) && hasValue(pr) && hasValue(kr)) {
      statsMap["total_yards_gained"] = {
        team1: sum(off.team1, pr.team1, kr.team1),
        team2: sum(off.team2, pr.team2, kr.team2),
      };
    }
  }

  // Derive defensive red zone % as 100 - opponent's offensive red zone %.
  // If NO converted 66% offensively, AK's defense stopped them 34% of the time.
  const offPct = statsMap["red_zone_off_percentage"];
  if (offPct) {
    const t1Off = parseInt(offPct.team1, 10);
    const t2Off = parseInt(offPct.team2, 10);
    statsMap["red_zone_def_percentage"] = {
      team1: isNaN(t2Off) ? "" : String(100 - t2Off),
      team2: isNaN(t1Off) ? "" : String(100 - t1Off),
    };
  }

  // Warn about any expected stats that couldn't be parsed.
  const warnings = results.flatMap((r) => r.warnings);
  for (const key of ALL_STAT_KEYS) {
    if (!hasValue(statsMap[key])) warnings.push(`Stat not found: ${key}`);
  }

  return { score, stats: statsMap, warnings, missingRequired: computeMissingRequired(score, statsMap), labelSamples };
}
