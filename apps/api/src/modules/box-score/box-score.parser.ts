import sharp from "sharp";
import Tesseract, { type Page as TesseractPage } from "tesseract.js";

// Singleton worker — initialized once, reused across requests.
let _worker: Tesseract.Worker | null = null;
let _workerInitializing: Promise<Tesseract.Worker> | null = null;
let _ocrChain: Promise<unknown> = Promise.resolve();

function withOcrLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _ocrChain.then(fn, fn);
  _ocrChain = run.then(() => undefined, () => undefined);
  return run;
}

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
  rowY?: number;
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
  third_down_conversions: "Third Down Conversions",
  fourth_down_conversions: "Fourth Down Conversions",
  two_point_conversions: "Two Point Conversions",
};

function hasValue(v: { team1: string; team2: string } | undefined): boolean {
  return !!v && (v.team1?.trim().length > 0 || v.team2?.trim().length > 0);
}

function hasBothSides(v: { team1: string; team2: string } | undefined): boolean {
  return !!v?.team1?.trim() && !!v?.team2?.trim();
}

// Every box-score cell always holds a value (negative, 0, or positive), so an
// empty side of a required stat is always an OCR miss worth a second read.
function hasIncompleteRequiredCell(statsMap: Record<string, { team1: string; team2: string }>): boolean {
  return REQUIRED_STAT_KEYS.some((key) => {
    const v = statsMap[key];
    return !v || !v.team1?.trim() || !v.team2?.trim();
  });
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
    if (!hasBothSides(statsMap[key])) missing.push(FIELD_DISPLAY_NAMES[key] ?? key);
  }
  return missing;
}

// ─── Image preprocessing ─────────────────────────────────────────────────────

// "default": global threshold — fast, proven for the dark-panel scoreboard.
// "stats":   CLAHE on the full frame — recovers stat-table digits without crushing the left column.
// "robust":  stronger CLAHE for dim rows over the bright field background.
export type PreprocessVariant = "default" | "stats" | "robust";

async function preprocessImage(
  buffer: Buffer,
  variant: PreprocessVariant = "default",
): Promise<{ processed: Buffer; width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  // Upscale small captures (e.g. 817px wide) — without this, Tesseract often returns nothing.
  const MIN_OCR_WIDTH = 1024;
  const targetWidth = Math.min(Math.max(originalWidth, MIN_OCR_WIDTH), 1920);

  let pipeline = sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: false })
    .grayscale();

  if (variant === "robust") {
    pipeline = pipeline.clahe({ width: 128, height: 128, maxSlope: 3 }).negate();
  } else if (variant === "stats") {
    pipeline = pipeline.clahe({ width: 64, height: 64, maxSlope: 2 }).normalise().negate();
  } else {
    pipeline = pipeline
      .normalise()
      .threshold(100)
      .negate();
  }

  const processed = await pipeline.png().toBuffer();
  const processedMeta = await sharp(processed).metadata();
  return { processed, width: processedMeta.width!, height: processedMeta.height! };
}

// ─── Word extraction ─────────────────────────────────────────────────────────

// Stat value column thresholds (also used when filtering low-confidence digits).
const LEFT_VAL_X_MAX = 0.20;
const RIGHT_VAL_X_MIN = 0.80;

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

async function extractNormalizedWords(buffer: Buffer, variant: PreprocessVariant = "default"): Promise<{ words: NormalizedWord[]; width: number; height: number }> {
  const { processed, width, height } = await preprocessImage(buffer, variant);
  const worker = await getWorker();
  const result = await withOcrLock(() => worker.recognize(processed, undefined, { blocks: true }));

  const rawWords = flattenPageWords(result.data);

  const words: NormalizedWord[] = rawWords
    .filter((w) => {
      if (w.text.trim().length === 0) return false;
      if (w.confidence > 25) return true;
      const cx = ((w.bbox.x0 + w.bbox.x1) / 2) / width;
      // Keep low-confidence lone digits in the stat value columns — arrow rows
      // often lose one side (e.g. fourth-down 0/3) at the default threshold.
      return (cx < LEFT_VAL_X_MAX || cx > RIGHT_VAL_X_MIN) && /^[0-9Oo°©¢]+$/.test(w.text.trim()) && w.confidence > 12;
    })
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

// Left column digits sit on a dark panel; a global threshold often destroys them.
const LEFT_COL_CROP_FRAC = 0.32;

type LeftColPreprocess = "threshold" | "clahe" | "soft";

async function preprocessColumnCrop(
  cropBuffer: Buffer,
  cropWidth: number,
  height: number,
  variant: LeftColPreprocess,
): Promise<Buffer> {
  let pipeline = sharp(cropBuffer)
    .grayscale();

  if (variant === "threshold") {
    pipeline = pipeline.normalise().threshold(80).negate();
  } else if (variant === "clahe") {
    pipeline = pipeline.clahe({ width: 48, height: 48, maxSlope: 3 }).normalise().negate();
  } else {
    pipeline = pipeline.normalise().linear(1.6, -35).sharpen().negate();
  }

  return pipeline
    .resize(cropWidth * 2, height * 2, { fit: "fill" })
    .png()
    .toBuffer();
}

async function preprocessLeftCrop(
  resized: Buffer,
  cropWidth: number,
  height: number,
  variant: LeftColPreprocess,
): Promise<Buffer> {
  const crop = await sharp(resized)
    .extract({ left: 0, top: 0, width: cropWidth, height })
    .toBuffer();
  return preprocessColumnCrop(crop, cropWidth, height, variant);
}

function mapLeftCropWords(rawWords: Tesseract.Word[], ocrWidth: number, ocrHeight: number): NormalizedWord[] {
  return rawWords
    .filter((w) => {
      if (w.text.trim().length === 0) return false;
      if (w.confidence > 18) return true;
      return /^[0-9/:>\-]+$/.test(w.text.trim()) && w.confidence > 8;
    })
    .map((w) => {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2 / ocrWidth;
      const mappedX = cx * LEFT_COL_CROP_FRAC;
      return {
        text: w.text.trim(),
        confidence: w.confidence,
        x: mappedX,
        y: (w.bbox.y0 + w.bbox.y1) / 2 / ocrHeight,
        x0: (w.bbox.x0 / ocrWidth) * LEFT_COL_CROP_FRAC,
        x1: (w.bbox.x1 / ocrWidth) * LEFT_COL_CROP_FRAC,
        y0: w.bbox.y0 / ocrHeight,
        y1: w.bbox.y1 / ocrHeight,
      };
    });
}

/** Pull numeric tokens out of noisy left-column OCR (e.g. ">143" -> "143"). */
function salvageDigitWords(words: NormalizedWord[]): NormalizedWord[] {
  const out: NormalizedWord[] = [];
  for (const w of words) {
    const text = w.text.replace(/[Oo]/g, "0");
    const ratio = text.match(/(\d+)\s*[\/:]\s*(\d+)/);
    if (ratio) {
      out.push({ ...w, text: `${ratio[1]}/${ratio[2]}`, confidence: w.confidence * 0.92 });
      continue;
    }
    const digits = text.match(/\d+/);
    if (!digits || digits[0].length > 4) continue;
    out.push({ ...w, text: digits[0], confidence: w.confidence * 0.88 });
  }
  return out;
}

const RIGHT_COL_CROP_FRAC = 0.32;

function mapRightCropWords(rawWords: Tesseract.Word[], ocrWidth: number, ocrHeight: number): NormalizedWord[] {
  const xOffset = 1 - RIGHT_COL_CROP_FRAC;
  return rawWords
    .filter((w) => {
      if (w.text.trim().length === 0) return false;
      if (w.confidence > 18) return true;
      return /^[0-9/:>\-]+$/.test(w.text.trim()) && w.confidence > 8;
    })
    .map((w) => {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2 / ocrWidth;
      const mappedX = xOffset + cx * RIGHT_COL_CROP_FRAC;
      return {
        text: w.text.trim(),
        confidence: w.confidence,
        x: mappedX,
        y: (w.bbox.y0 + w.bbox.y1) / 2 / ocrHeight,
        x0: xOffset + (w.bbox.x0 / ocrWidth) * RIGHT_COL_CROP_FRAC,
        x1: xOffset + (w.bbox.x1 / ocrWidth) * RIGHT_COL_CROP_FRAC,
        y0: w.bbox.y0 / ocrHeight,
        y1: w.bbox.y1 / ocrHeight,
      };
    });
}

async function extractRightColumnWords(buffer: Buffer): Promise<NormalizedWord[]> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  const targetWidth = Math.min(Math.max(originalWidth, 1024), 1920);
  const resized = await sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const actualWidth = resizedMeta.width ?? 1920;
  const actualHeight = resizedMeta.height ?? 1080;
  const cropWidth = Math.max(1, Math.round(actualWidth * RIGHT_COL_CROP_FRAC));
  const cropLeft = actualWidth - cropWidth;

  const worker = await getWorker();
  const variants: LeftColPreprocess[] = ["clahe", "threshold", "soft"];
  const allWords: NormalizedWord[] = [];

  for (const variant of variants) {
    const crop = await sharp(resized)
      .extract({ left: cropLeft, top: 0, width: cropWidth, height: actualHeight })
      .toBuffer();
    const processed = await preprocessColumnCrop(crop, cropWidth, actualHeight, variant);
    const result = await withOcrLock(() => worker.recognize(processed, undefined, { blocks: true }));
    allWords.push(...mapRightCropWords(flattenPageWords(result.data), cropWidth * 2, actualHeight * 2));
  }

  return dedupeWords(allWords);
}

async function extractLeftColumnWords(buffer: Buffer): Promise<NormalizedWord[]> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  const targetWidth = Math.min(Math.max(originalWidth, 1024), 1920);
  const resized = await sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const actualWidth = resizedMeta.width ?? 1920;
  const actualHeight = resizedMeta.height ?? 1080;
  const cropWidth = Math.max(1, Math.round(actualWidth * LEFT_COL_CROP_FRAC));

  const worker = await getWorker();
  const variants: LeftColPreprocess[] = ["clahe", "threshold", "soft"];
  const allWords: NormalizedWord[] = [];

  for (const variant of variants) {
    const processed = await preprocessLeftCrop(resized, cropWidth, actualHeight, variant);
    const result = await withOcrLock(() => worker.recognize(processed, undefined, { blocks: true }));
    allWords.push(...mapLeftCropWords(flattenPageWords(result.data), cropWidth * 2, actualHeight * 2));
  }

  return dedupeWords(allWords);
}

function dedupeWords(words: NormalizedWord[]): NormalizedWord[] {
  const out: NormalizedWord[] = [];
  for (const w of words) {
    const existing = out.find(
      (e) => Math.abs(e.x - w.x) < 0.02 && Math.abs(e.y - w.y) < 0.015,
    );
    if (!existing) {
      out.push(w);
      continue;
    }
    if (w.confidence > existing.confidence) {
      out[out.indexOf(existing)] = w;
    }
  }
  return out;
}

function mergeStatWords(
  leftWords: NormalizedWord[],
  rightWords: NormalizedWord[],
  bodyWords: NormalizedWord[],
  defaultWords: NormalizedWord[],
  statsTopY: number,
): NormalizedWord[] {
  const zoneMinY = statZoneMinY(statsTopY);
  const inZone = (w: NormalizedWord) => w.y >= zoneMinY;
  const left = dedupeWords([
    ...leftWords.filter((w) => inZone(w) && w.x < LEFT_VAL_X_MAX),
    ...bodyWords.filter((w) => inZone(w) && w.x < LEFT_VAL_X_MAX),
    ...salvageDigitWords(defaultWords.filter((w) => inZone(w) && w.x < LEFT_VAL_X_MAX)),
  ]);
  const right = dedupeWords([
    ...rightWords.filter((w) => inZone(w) && w.x > RIGHT_VAL_X_MIN),
    ...bodyWords.filter((w) => inZone(w) && w.x > RIGHT_VAL_X_MIN),
    ...salvageDigitWords(defaultWords.filter((w) => inZone(w) && w.x > RIGHT_VAL_X_MIN)),
  ]);
  const body = dedupeWords(bodyWords.filter(inZone));
  const defaultFill = dedupeWords(defaultWords.filter((w) => inZone(w) && w.x >= LEFT_VAL_X_MAX && w.x <= RIGHT_VAL_X_MIN));

  const merged = [...left, ...right, ...body];
  for (const w of defaultFill) {
    const overlap = merged.some((m) => Math.abs(m.x - w.x) < 0.02 && Math.abs(m.y - w.y) < 0.015);
    if (!overlap) merged.push(w);
  }
  return merged;
}

function mergeWordLists(...lists: NormalizedWord[][]): NormalizedWord[] {
  const out: NormalizedWord[] = [];
  for (const list of lists) out.push(...list);
  return out;
}

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
const SCORE_ABBR_X_MIN = 0.30;
const SCORE_ABBR_X_MAX = 0.42;
const SCORE_CELL_X_TOLERANCE = 0.022;
const SCORE_QUARTER_COLUMNS = [0.432, 0.473, 0.516, 0.558, 0.601] as const;
const SCORE_TOTAL_X = 0.641;

// Common Madden scoreboard OCR misreads (only unambiguous NFL typos — custom league abbrs like SDG stay as-is).
// Madden scoreboard OCR misreads — explicit map only (custom league abbrs like SDG, AK stay as-is).
const ABBR_OCR_TYPOS: Record<string, string> = {
  NYJD: "NYJ",
  LEV: "LV",
  LCV: "LAR",
  SFN: "SF",
  N0: "NO",
  AR1: "ARI",
  CLF: "CLE",
  RTT: "HOU",
  VAX: "JAX",
  TREE: "SDG",
  AM: "ATL",
  ATI: "ATL",
  JAK: "JAX",
  HO0: "HOU",
};

function correctTeamAbbr(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "???";
  if (ABBR_OCR_TYPOS[cleaned]) return ABBR_OCR_TYPOS[cleaned];
  return cleaned;
}

function parseScoreToken(text: string): number | null {
  const normalized = text
    .replace(/[Oo]/g, "0")
    .replace(/^o+$/i, "0")
    .replace(/[^0-9]/g, "");
  if (!normalized) return null;
  const n = parseInt(normalized, 10);
  return isNaN(n) ? null : n;
}

// Decorative UI glyphs between scoreboard rows otherwise merge AZ/NO into one OCR row.
function isScoreboardNoise(text: string): boolean {
  return /^[\\|/_\[\](){}<>,.;:!@#$%^&*\-=+~`"'«»•]+$/.test(text);
}

function looksLikeScoreboardZero(text: string): boolean {
  return /^[oO0©°¢Oo]$/.test(text.trim());
}

function scoreDigitAt(word: NormalizedWord, x: number): { value: number; confidence: number } | null {
  const dx = Math.abs(word.x - x);
  if (dx > SCORE_CELL_X_TOLERANCE) return null;

  const parsed = parseScoreToken(word.text);
  if (parsed != null) return { value: parsed, confidence: word.confidence };
  if (looksLikeScoreboardZero(word.text)) return { value: 0, confidence: word.confidence };
  return null;
}

// Tighter than the stats-table tolerance — UI chrome between rows is ~0.02–0.03 apart.
const SCORE_ROW_Y_TOLERANCE = 0.025;
const SCORE_ABBR_ROW_Y_TOLERANCE = 0.035;

function rowAvgY(row: NormalizedWord[]): number {
  return row.reduce((s, w) => s + w.y, 0) / row.length;
}

function countScoreColumns(row: NormalizedWord[]): number {
  let n = 0;
  for (const x of SCORE_QUARTER_COLUMNS) {
    if (row.some((w) => scoreDigitAt(w, x) != null)) n++;
  }
  if (row.some((w) => scoreDigitAt(w, SCORE_TOTAL_X) != null)) n++;
  return n;
}

function findScoreboardTeamRows(headerWords: NormalizedWord[]): NormalizedWord[][] {
  const cleaned = headerWords.filter((w) => !isScoreboardNoise(w.text));

  // Prefer digit-complete rows sorted top-to-bottom (away team first).
  const grouped = groupIntoRows(cleaned, SCORE_ROW_Y_TOLERANCE);
  const scoreRows = grouped
    .filter((row) => countScoreColumns(row) >= 4)
    .sort((a, b) => rowAvgY(a) - rowAvgY(b));
  if (scoreRows.length >= 2) return scoreRows.slice(0, 2);

  const abbrCandidates = cleaned
    .filter((w) => /^[A-Z]{2,4}$/.test(w.text) && w.confidence > 40 && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX)
    .sort((a, b) => a.y - b.y);

  const abbrs: NormalizedWord[] = [];
  for (const candidate of abbrCandidates) {
    if (!abbrs.some((existing) => Math.abs(existing.y - candidate.y) < SCORE_ROW_Y_TOLERANCE)) {
      abbrs.push(candidate);
    }
  }

  if (abbrs.length >= 2) {
    return abbrs.slice(0, 2).map((abbr) =>
      cleaned.filter((w) => {
        const dy = Math.abs(w.y - abbr.y);
        if (w.x > SCORE_ABBR_X_MAX) return dy <= SCORE_ABBR_ROW_Y_TOLERANCE;
        return /^[A-Za-z]{2,4}$/.test(w.text) && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX && dy <= SCORE_ROW_Y_TOLERANCE;
      }),
    );
  }

  return grouped.filter((row) => {
    const abbr = row.some((w) => /^[A-Za-z]{2,4}$/.test(w.text) && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX);
    const nums = row.filter((w) => w.x > SCORE_ABBR_X_MAX && (
      SCORE_QUARTER_COLUMNS.some((x) => scoreDigitAt(w, x) != null) || scoreDigitAt(w, SCORE_TOTAL_X) != null
    ));
    return abbr && nums.length >= 3;
  });
}

function scoreValueAtColumn(row: NormalizedWord[], x: number): { value: number; confidence: number } | null {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const inCol = sorted.filter((w) => Math.abs(w.x - x) <= SCORE_CELL_X_TOLERANCE);
  if (inCol.length === 0) return null;

  // Join split digit tokens in one column (e.g. Q4 "1" + "0" -> 10).
  const digitParts = inCol
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text.replace(/[Oo]/g, "0").replace(/[^0-9]/g, ""))
    .filter(Boolean);
  if (digitParts.length >= 2 && digitParts.every((p) => p.length === 1)) {
    const joined = parseInt(digitParts.join(""), 10);
    if (!isNaN(joined) && joined <= 35) {
      const confidence = inCol.reduce((s, w) => s + w.confidence, 0) / inCol.length;
      return { value: joined, confidence };
    }
  }

  const candidates = inCol
    .map((w) => ({ word: w, cell: scoreDigitAt(w, x), dx: Math.abs(w.x - x) }))
    .filter((c): c is { word: NormalizedWord; cell: { value: number; confidence: number }; dx: number } => c.cell != null)
    .sort((a, b) => a.dx - b.dx || b.cell.confidence - a.cell.confidence);
  return candidates[0]?.cell ?? null;
}

function reconcileRowScore(
  quarters: number[],
  quarterCells: ({ value: number; confidence: number } | null)[],
  totalCell: { value: number; confidence: number } | null,
): { quarters: number[]; total: number } {
  const qs = [...quarters];
  let sum = qs.reduce((s, n) => s + n, 0);
  let total = totalCell?.value ?? sum;

  if (sum > 0 && total === 0) total = sum;

  // Iteratively repair quarters until they match the total column (handles 21->2, 10->1, etc.).
  let guard = 0;
  while (totalCell && sum < totalCell.value && guard++ < 6) {
    const deficit = totalCell.value - sum;
    if (deficit <= 0) break;

    const bump = quarterCells
      .map((cell, idx) => ({ cell, idx, q: qs[idx] }))
      .filter(({ q }) => q > 0 && q < 10 && q + deficit <= 21)
      .sort((a, b) => (a.cell?.confidence ?? 100) - (b.cell?.confidence ?? 100))[0];
    if (bump) {
      qs[bump.idx] = bump.q + deficit;
      sum = qs.reduce((s, n) => s + n, 0);
      continue;
    }

    const partialBump = quarterCells
      .map((cell, idx) => ({ cell, idx, q: qs[idx] }))
      .filter(({ q }) => q > 0 && q < 10 && q < 21)
      .sort((a, b) => (a.cell?.confidence ?? 100) - (b.cell?.confidence ?? 100))[0];
    if (partialBump) {
      const add = Math.min(deficit, 21 - partialBump.q);
      if (add > 0) {
        qs[partialBump.idx] = partialBump.q + add;
        sum = qs.reduce((s, n) => s + n, 0);
        continue;
      }
    }

    const lastNonZero = qs.reduce((last, q, idx) => (q > 0 ? idx : last), -1);
    const zero = quarterCells
      .map((cell, idx) => ({ cell, idx, q: qs[idx] }))
      .filter(({ q, idx }) => q === 0 && deficit >= 1 && deficit <= 21 && (lastNonZero < 0 || idx < lastNonZero))
      .sort((a, b) => b.idx - a.idx || (a.cell?.confidence ?? 100) - (b.cell?.confidence ?? 100))[0];
    if (zero) {
      qs[zero.idx] = deficit;
      sum = qs.reduce((s, n) => s + n, 0);
      continue;
    }

    const anyZero = quarterCells
      .map((cell, idx) => ({ cell, idx, q: qs[idx] }))
      .filter(({ q }) => q === 0 && deficit >= 1 && deficit <= 21)
      .sort((a, b) => (a.cell?.confidence ?? 100) - (b.cell?.confidence ?? 100))[0];
    if (anyZero) {
      qs[anyZero.idx] = deficit;
      sum = qs.reduce((s, n) => s + n, 0);
      continue;
    }
    break;
  }

  if (sum > total + 5 && sum <= 80) total = sum;
  if (sum > 0 && sum < total && total - sum <= 3) total = sum;

  if (total < sum) {
    const fix = quarterCells
      .map((cell, idx) => ({ cell, idx }))
      .filter(({ cell }) => cell && sum - cell.value === total)
      .sort((a, b) => (a.cell?.confidence ?? 100) - (b.cell?.confidence ?? 100))[0];
    if (fix) qs[fix.idx] = 0;
    sum = qs.reduce((s, n) => s + n, 0);
  }

  if (totalCell && Math.abs(totalCell.value - sum) <= 3) total = sum;
  else if (sum > total && sum <= 80) total = sum;

  return { quarters: qs, total };
}

function parseScoreHeader(words: NormalizedWord[]): { score: ParsedScore; statsTopY: number } | null {
  const headerWords = words.filter((w) => w.y < HEADER_Y_MAX);
  const teamRows = findScoreboardTeamRows(headerWords);

  if (teamRows.length < 2) return null;

  const parseRow = (row: NormalizedWord[]) => {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const rowY = rowAvgY(sorted);
    const abbrWord =
      sorted.find((w) => /^[A-Z]{2,4}$/.test(w.text) && w.confidence > 40 && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX) ??
      headerWords
        .filter(
          (w) =>
            /^[A-Z]{2,4}$/.test(w.text) &&
            w.confidence > 35 &&
            w.x >= SCORE_ABBR_X_MIN &&
            w.x <= SCORE_ABBR_X_MAX &&
            Math.abs(w.y - rowY) < SCORE_ABBR_ROW_Y_TOLERANCE,
        )
        .sort((a, b) => Math.abs(a.y - rowY) - Math.abs(b.y - rowY) || b.confidence - a.confidence)[0];
    const abbr =
      abbrWord?.text ??
      sorted.find((w) => /^[A-Za-z]{2,4}$/.test(w.text) && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX)?.text?.toUpperCase() ??
      "???";

    const quarterCells = SCORE_QUARTER_COLUMNS.map((x) => scoreValueAtColumn(sorted, x));
    const totalCell = scoreValueAtColumn(sorted, SCORE_TOTAL_X);
    const quarters = quarterCells.map((c) => c?.value ?? 0);
    const reconciled = reconcileRowScore(quarters, quarterCells, totalCell);

    return { abbr: correctTeamAbbr(abbr), total: reconciled.total, quarters: reconciled.quarters };
  };

  const t1 = parseRow(teamRows[0]);
  const t2 = parseRow(teamRows[1]);

  // Duplicate abbr on both rows (e.g. SDG misread twice while NE is present elsewhere).
  if (t1.abbr === t2.abbr) {
    const headerAbbrs = headerWords
      .filter((w) => /^[A-Z]{2,4}$/.test(w.text) && w.confidence > 35 && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX)
      .map((w) => correctTeamAbbr(w.text));
    const alt = headerAbbrs.find((a) => a !== t1.abbr && a !== "???");
    if (alt) t2.abbr = alt;
  }

  // The stats table starts just below the lowest scoreboard row. Deriving the
  // boundary from the actual scoreboard (rather than a fixed cutoff) keeps the
  // top stat rows — Off Yards Gained / Off Rush Yards — from being clipped.
  const teamRowMaxY = Math.max(...teamRows[0].map((w) => w.y), ...teamRows[1].map((w) => w.y));
  const rawStatsTopY = teamRowMaxY + 0.012;
  const statsTopY = Math.min(Math.max(rawStatsTopY, STATS_Y_MIN), 0.33);

  return {
    score: {
      team1Abbr: t1.abbr,
      team2Abbr: t2.abbr,
      team1Score: t1.total,
      team2Score: t2.total,
      team1Quarters: t1.quarters,
      team2Quarters: t2.quarters,
    },
    statsTopY,
  };
}

// ─── Stats table parsing ──────────────────────────────────────────────────────

// Fallback start of the stats table, used only when the scoreboard can't be
// located. Normally the boundary is derived dynamically from the scoreboard's
// lowest row (see parseScoreHeader) so the top stat rows aren't clipped.
const STATS_Y_MIN = 0.28;
// Rows above the scoreboard-derived boundary (Off Yards / Rush / Pass sit ~3 rows up).
const STAT_ZONE_ABOVE_SLACK = 0.15;

function statZoneMinY(statsTopY: number): number {
  return Math.max(STATS_Y_MIN - 0.02, statsTopY - STAT_ZONE_ABOVE_SLACK);
}
// Column thresholds (relative to image width). LEFT/RIGHT bounds defined above.
const CENTER_X_MIN = 0.18;
const CENTER_X_MAX = 0.82;
const ROW_Y_TOLERANCE = 0.04;
const LABEL_ROW_Y_TOLERANCE = 0.025;
const ARROW_STAT_ROW_Y_TOLERANCE = 0.045;

const SMALL_ARROW_STAT_KEYS = new Set([
  "turnovers",
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
]);

function validateStatValue(key: string, value: string): string {
  const v = value.trim();
  if (!v) return "";

  if (key.includes("percentage")) {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 0 && n <= 100 ? String(n) : "";
  }
  return /^\d+$/.test(v) ? v : "";
}

function cleanStatValue(raw: string, opts: { side: "left" | "right"; key: string }): string {
  const stripped = raw
    .replace(/[Oo]/g, "0")
    .replace(/[>▶◀◁▷◄]/g, "");

  const cleaned = stripped
    .replace(/^[^0-9:]+/, "")
    .replace(/[^0-9:]+$/, "")
    .trim();

  // Fused expander/better-stat arrows read as a trailing 4: 0◄ -> 04, 3◄ -> 34.
  if (SMALL_ARROW_STAT_KEYS.has(opts.key) && /^\d4$/.test(cleaned)) {
    return cleaned.slice(0, -1);
  }

  if (cleaned) return cleaned;

  const digitRun = stripped.match(/\d+/);
  if (digitRun) {
    const v = digitRun[0];
    if (SMALL_ARROW_STAT_KEYS.has(opts.key) && v.length === 2 && v.endsWith("4")) {
      return v.slice(0, -1);
    }
    return v;
  }

  return "";
}

const LABEL_OCR_ALIASES: Record<string, string> = {
  "of pass yards": "off pass yards",
  "of first down": "off first down",
  "off fist down": "off first down",
  "off first downs": "off first down",
  "off irat down": "off first down",
  "off yards galned": "off yards gained",
  "off yards gai ned": "off yards gained",
  "off rush vards": "off rush yards",
  "tota yards gained": "total yards gained",
  "total vards gained": "total yards gained",
  "pint conversions": "two point conversions",
  "two pint conversions": "two point conversions",
  "red zone of percentage": "red zone off percentage",
  "red zone off uw": "red zone off percentage",
  "ot yards gained": "off yards gained",
  "oft rush vars": "off rush yards",
  "oftpass yards": "off pass yards",
  "tota yor gined": "total yards gained",
  "punt retur yards": "punt return yards",
  "kick retur yards": "kick return yards",
  "fourth down comrsions": "fourth down conversions",
  "tie down conversions": "third down conversions",
  "off pass yard": "off pass yards",
  "of fst down": "off first down",
  taos: "turnovers",
  tumovers: "turnovers",
  down: "off first down",
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function fixLabelOcr(text: string): string {
  return text
    .replace(/\bfist\b/g, "first")
    .replace(/\bof\b(?=\s+(?:yards|rush|pass|first))/g, "off")
    .replace(/^ot\s/, "off ")
    .replace(/^oft\s*/, "off ")
    .replace(/^oftpass/, "off pass")
    .replace(/\bgalned\b/g, "gained")
    .replace(/\bgined\b/g, "gained")
    .replace(/\byor\b/g, "yards")
    .replace(/\bvars\b/g, "yards")
    .replace(/\bvards\b/g, "yards")
    .replace(/\bretur\b/g, "return")
    .replace(/\bcomrsions\b/g, "conversions")
    .replace(/\bbown\b/g, "down")
    .replace(/\bpint\b/g, "point")
    .replace(/\bpossesion\b/g, "possession")
    .replace(/\bfst\b/g, "first")
    .replace(/\byerds\b/g, "yards")
    .replace(/\byords\b/g, "yards")
    .replace(/\bbows\b/g, "down")
    .replace(/\btumovers\b/g, "turnovers")
    .replace(/\bta\s*os\b/g, "turnovers")
    .replace(/\btwa\b/g, "two")
    .replace(/\bcanversions\b/g, "conversions")
    .replace(/\bcarve ach\b/g, "conversions")
    .replace(/\bredzone\b/g, "red zone")
    .replace(/\btime ot\b/g, "time of")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(text: string): string {
  const normalized = fixLabelOcr(text.toLowerCase().replace(/\s+/g, " ").trim());
  return LABEL_OCR_ALIASES[normalized] ?? normalized;
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

  // OCR typo tolerance (e.g. "off fist down" → "off first down").
  for (const [label, key] of Object.entries(STAT_LABEL_MAP)) {
    if (normalized.length >= 8 && levenshtein(normalized, label) <= 2) {
      return { key, via: "fuzzy" };
    }
    if (label.length >= 8 && normalized.length >= 4 && levenshtein(normalized, label) <= 4) {
      return { key, via: "fuzzy" };
    }
  }
  return null;
}

// A stat has exactly one value per column. Pick that single token rather than
// joining everything in the band (which bled in the next row's number) and pick
// the right token within the row: the value sits to the RIGHT of the ▶ expander
// in the left column, and to the LEFT of the ◄ "better stat" arrow in the right
// column — those arrows otherwise get misread as digits.
function findConversionValue(
  candidates: NormalizedWord[],
  targetY: number,
  side: "left" | "right",
  key: string,
): string {
  const sideWords = candidates
    .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
    .map((w) => ({ w, dy: Math.abs(w.y - targetY) }))
    .sort((a, b) => a.dy - b.dy || (side === "left" ? b.w.x - a.w.x : a.w.x - b.w.x));

  const closest = sideWords[0];
  if (!closest || closest.dy > 0.032) return "";

  const rowY = closest.w.y;
  const sameRow = candidates.filter(
    (w) =>
      Math.abs(w.y - rowY) <= 0.012 &&
      (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN),
  );

  const joined = [...sameRow]
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text.replace(/[Oo]/g, "0").replace(/[>▶◀◁▷◄]/g, ""))
    .join("");
  const ratio = joined.match(/(\d+)\s*[\/:]\s*(\d+)/);
  if (ratio) return validateStatValue(key, `${ratio[1]}/${ratio[2]}`);

  for (const w of sameRow.sort((a, b) => (side === "left" ? b.x - a.x : a.x - b.x))) {
    const v = validateStatValue(key, cleanStatValue(w.text, { side, key }));
    if (v) return v;
  }

  // Lone made-count with attempts on a adjacent token (▶1 /4 split across tokens).
  const parts = sameRow
    .sort((a, b) => a.x - b.x)
    .map((w) => cleanStatValue(w.text, { side, key }))
    .filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return validateStatValue(key, `${parts[0]}/${parts[1]}`);
  }

  return parts[0] ? validateStatValue(key, parts[0]) : "";
}

function findValueNearY(candidates: NormalizedWord[], targetY: number, side: "left" | "right", key: string): string {
  if (key === "turnovers") {
    const leftMax = 0.24;
    const rightMin = 0.76;
    const rowWords = candidates.filter(
      (w) =>
        Math.abs(w.y - targetY) < 0.05 &&
        (side === "left" ? w.x < leftMax : w.x > rightMin),
    );
    const joined = rowWords
      .sort((a, b) => a.x - b.x)
      .map((w) => w.text.replace(/[Oo]/g, "0").replace(/[>▶◀◁▷◄]/g, ""))
      .join("");
    const digit = joined.match(/\d{1,2}/);
    if (digit) {
      const n = parseInt(digit[0], 10);
      if (n >= 0 && n <= 10) return String(n);
    }
  }

  const yTolerance = SMALL_ARROW_STAT_KEYS.has(key)
    ? ARROW_STAT_ROW_Y_TOLERANCE
    : ROW_Y_TOLERANCE;

  const nearby = candidates.filter((w) => Math.abs(w.y - targetY) < yTolerance);
  if (nearby.length === 0) return "";

  // Keep only the row physically closest to the label; drop adjacent rows that
  // crept into the band. Arrow-adjacent stats need a tighter band so Q3/Q4 values
  // don't bleed into each other (e.g. fourth-down 3 vs two-point 0).
  const rowSlack = SMALL_ARROW_STAT_KEYS.has(key) ? 0.006 : 0.012;
  const minDy = Math.min(...nearby.map((w) => Math.abs(w.y - targetY)));
  const sameRow = nearby.filter((w) => Math.abs(w.y - targetY) <= minDy + rowSlack);

  if (key.includes("percentage")) {
    const pctRow = sameRow
      .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
      .sort((a, b) => a.x - b.x);
    const joinedDigits = pctRow.map((w) => w.text.replace(/\D/g, "")).join("");
    if (joinedDigits.length <= 3) {
      const pct = validateStatValue(key, joinedDigits);
      if (pct) return pct;
    }
    const orphanPct = candidates
      .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
      .map((w) => ({
        w,
        dy: Math.abs(w.y - targetY),
        v: validateStatValue(key, w.text.replace(/\D/g, "")),
      }))
      .filter((c) => c.v && c.dy < 0.04)
      .sort((a, b) => a.dy - b.dy);
    if (orphanPct[0]) return orphanPct[0].v;
  }

  // Left column: value is the rightmost token (▶ is to its left).
  // Right column: value is the leftmost token (◄ is to its right).
  sameRow.sort((a, b) => (side === "left" ? b.x - a.x : a.x - b.x));

  const ranked = sameRow
    .map((w) => {
      const v = validateStatValue(key, cleanStatValue(w.text, { side, key }));
      return { w, v, q: cellQuality(key, v), conf: w.confidence };
    })
    .filter((c) => c.v)
    .sort((a, b) => b.q - a.q || b.conf - a.conf || (side === "left" ? b.w.x - a.w.x : a.w.x - b.w.x));

  if (ranked[0]) return ranked[0].v;

  // Turnovers / arrow stats: lone digits beside ▶ often fail generic cleaning.
  if (key === "turnovers" || SMALL_ARROW_STAT_KEYS.has(key)) {
    const rowScan = candidates
      .filter(
        (w) =>
          Math.abs(w.y - targetY) < 0.04 &&
          (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN),
      )
      .sort((a, b) => Math.abs(a.y - targetY) - Math.abs(b.y - targetY) || (side === "left" ? b.x - a.x : a.x - b.x));
    for (const w of rowScan) {
      const digit = w.text.replace(/[Oo]/g, "0").replace(/\D/g, "");
      if (/^\d{1,2}$/.test(digit)) {
        const n = parseInt(digit, 10);
        if (n >= 0 && n <= 10) return String(n);
      }
    }
  }

  const orphan = candidates
    .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
    .map((w) => ({
      w,
      dy: Math.abs(w.y - targetY),
      v: validateStatValue(key, cleanStatValue(w.text, { side, key })),
      q: cellQuality(key, validateStatValue(key, cleanStatValue(w.text, { side, key }))),
    }))
    .filter((c) => c.v && c.dy < 0.035)
    .sort((a, b) => a.dy - b.dy || b.q - a.q || (side === "left" ? b.w.x - a.w.x : a.w.x - b.w.x));
  if (orphan[0]) return orphan[0].v;

  for (const w of sameRow) {
    const v = cleanStatValue(w.text, { side, key });
    if (v) return v;
  }

  // Last resort for arrow stats: a lone digit sometimes lands on the adjacent
  // OCR row when Madden fuses the value with the ◄ marker (e.g. 3◄ -> 34).
  if (SMALL_ARROW_STAT_KEYS.has(key)) {
    const orphan = candidates
      .filter((w) => Math.abs(w.y - targetY) < yTolerance + 0.025)
      .map((w) => ({ word: w, v: cleanStatValue(w.text, { side, key }) }))
      .filter((c) => c.v !== "" || /^[oO0°©¢]$/.test(c.word.text.trim()))
      .map((c) => (c.v === "" && /^[oO0°©¢]$/.test(c.word.text.trim()) ? { ...c, v: "0" } : c))
      .filter((c) => c.v)
      .sort((a, b) => Math.abs(a.word.y - targetY) - Math.abs(b.word.y - targetY) || (side === "left" ? b.word.x - a.word.x : a.word.x - b.word.x))[0];
    if (orphan) return orphan.v;
  }

  return "";
}

function parseStatRows(words: NormalizedWord[], aliases: LabelAliases, statsTopY: number = STATS_Y_MIN): ParsedStat[] {
  const zoneMinY = statZoneMinY(statsTopY);
  const statZone = words.filter((w) => w.y >= zoneMinY);

  const leftVals  = statZone.filter((w) => w.x < LEFT_VAL_X_MAX);
  const rightVals = statZone.filter((w) => w.x > RIGHT_VAL_X_MIN);
  const center    = statZone.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX);

  // Group center words into label rows
  const centerRows = groupIntoRows(center, LABEL_ROW_Y_TOLERANCE);

  const stats: ParsedStat[] = [];
  const seenKeys = new Set<string>();

  for (const row of centerRows) {
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const normalized = normalizeLabel(sortedRow.map((w) => w.text).join(" "));
    const rowY = sortedRow.reduce((s, w) => s + w.y, 0) / sortedRow.length;
    const match = matchStatLabel(normalized, aliases);

    if (!match || seenKeys.has(match.key)) continue;
    seenKeys.add(match.key);

    const team1Val = findValueNearY(leftVals, rowY, "left", match.key);
    const team2Val = findValueNearY(rightVals, rowY, "right", match.key);

    stats.push({
      key: match.key,
      team1: team1Val,
      team2: team2Val,
      rawLabel: normalized,
      matchedVia: match.via,
      rowY,
    });
  }

  return fillPositionalTurnovers(stats, centerRows, leftVals, rightVals);
}

function avgRowY(row: NormalizedWord[]): number {
  return row.reduce((s, w) => s + w.y, 0) / row.length;
}

/** Turnovers label often OCRs to garbage ("te", "taos"); it always sits between Total Yards and Third Down. */
function fillPositionalTurnovers(
  stats: ParsedStat[],
  centerRows: NormalizedWord[][],
  leftVals: NormalizedWord[],
  rightVals: NormalizedWord[],
): ParsedStat[] {
  const existing = stats.find((s) => s.key === "turnovers");
  if (existing?.team1?.trim() && existing?.team2?.trim()) return stats;

  const total = stats.find((s) => s.key === "total_yards_gained");
  const third = stats.find((s) => s.key === "third_down_conversions");
  if (!total?.rowY || !third?.rowY) return stats;

  const between = centerRows
    .map((row) => ({ row, y: avgRowY(row) }))
    .filter(({ y }) => y > total.rowY! && y < third.rowY!)
    .sort((a, b) => a.y - b.y);
  const turnoverRow = between[0];
  if (!turnoverRow) return stats;

  const rowY = turnoverRow.y;
  const team1 = findValueNearY(leftVals, rowY, "left", "turnovers") || existing?.team1 || "";
  const team2 = findValueNearY(rightVals, rowY, "right", "turnovers") || existing?.team2 || "";
  if (!team1 && !team2) return stats;

  const out = stats.filter((s) => s.key !== "turnovers");
  out.push({
    key: "turnovers",
    team1,
    team2,
    rawLabel: turnoverRow.row.map((w) => w.text).join(" ") || "(positional turnovers)",
    matchedVia: "fuzzy",
    rowY,
  });
  return out;
}

const OFFENSE_ROW_STEP = 0.0385;

/** Fill top offensive values only when the Off Yards Gained label is on screen. */
function fillInferredTopOffense(
  words: NormalizedWord[],
  stats: ParsedStat[],
  aliases: LabelAliases,
  statsTopY: number,
): ParsedStat[] {
  const keys = new Set(stats.map((s) => s.key));
  if (
    keys.has("off_yards_gained") &&
    keys.has("off_rush_yards") &&
    keys.has("off_pass_yards")
  ) {
    return stats;
  }
  // Scrolled screenshots start at Off First Down — do not infer clipped top rows.
  if (!hasOffYardsGainedLabel(stats)) return stats;

  const zoneMinY = statZoneMinY(statsTopY);
  const valueMinY = Math.max(STATS_Y_MIN - 0.04, statsTopY - 0.16);
  const statZone = words.filter((w) => w.y >= zoneMinY);
  const valueZone = words.filter((w) => w.y >= valueMinY);
  const center = statZone.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX);
  const leftVals = valueZone.filter((w) => w.x < LEFT_VAL_X_MAX);
  const rightVals = valueZone.filter((w) => w.x > RIGHT_VAL_X_MIN);

  let anchorY: number | null = null;
  for (const row of groupIntoRows(center, LABEL_ROW_Y_TOLERANCE)) {
    const label = normalizeLabel([...row].sort((a, b) => a.x - b.x).map((w) => w.text).join(" "));
    const match = matchStatLabel(label, aliases);
    if (match?.key === "off_first_down") {
      anchorY = row.reduce((s, w) => s + w.y, 0) / row.length;
      break;
    }
  }
  if (anchorY == null) return stats;

  const out = [...stats];
  const seen = new Set(out.map((s) => s.key));
  for (const { key, offset } of [
    { key: "off_pass_yards", offset: 1 },
    { key: "off_rush_yards", offset: 2 },
    { key: "off_yards_gained", offset: 3 },
  ] as const) {
    if (seen.has(key)) continue;
    const targetY = anchorY - offset * OFFENSE_ROW_STEP;
    const team1 = findValueNearY(leftVals, targetY, "left", key);
    const team2 = findValueNearY(rightVals, targetY, "right", key);
    if (team1 || team2) {
      out.push({ key, team1, team2, rawLabel: `(inferred ${key})`, matchedVia: "fuzzy" });
      seen.add(key);
    }
  }
  return out;
}

function scoreQuality(score: ParsedScore | null): number {
  if (!score) return 0;
  let q = 0;
  if (/^[A-Z]{2,4}$/.test(score.team1Abbr)) q += 10;
  if (/^[A-Z]{2,4}$/.test(score.team2Abbr)) q += 10;
  const sum1 = score.team1Quarters.reduce((s, n) => s + n, 0);
  const sum2 = score.team2Quarters.reduce((s, n) => s + n, 0);
  if (sum1 === score.team1Score) q += 20;
  else if (Math.abs(sum1 - score.team1Score) <= 9) q += 8;
  else if (sum1 > 0 && score.team1Score === 0) q -= 15;
  if (sum2 === score.team2Score) q += 20;
  else if (Math.abs(sum2 - score.team2Score) <= 9) q += 8;
  else if (sum2 > 0 && score.team2Score === 0) q -= 15;
  if (score.team1Score + score.team2Score === 0 && sum1 + sum2 > 0) q -= 25;
  return q;
}

function reconcileScoreTotals(score: ParsedScore): ParsedScore {
  const sum1 = score.team1Quarters.reduce((s, n) => s + n, 0);
  const sum2 = score.team2Quarters.reduce((s, n) => s + n, 0);
  const fixTotal = (displayed: number, sum: number) => {
    if (sum > 80) return displayed > 80 ? displayed : sum <= 80 ? sum : displayed;
    if (sum > 0 && displayed === 0) return sum;
    if (sum > displayed + 5 && sum <= 80) return sum;
    if (Math.abs(displayed - sum) <= 3) return sum;
    return displayed;
  };
  return {
    ...score,
    team1Score: fixTotal(score.team1Score, sum1),
    team2Score: fixTotal(score.team2Score, sum2),
  };
}

function pickBestScore(...candidates: (ParsedScore | null | undefined)[]): ParsedScore | null {
  return candidates
    .filter((s): s is ParsedScore => s != null)
    .map(reconcileScoreTotals)
    .sort((a, b) => scoreQuality(b) - scoreQuality(a))[0] ?? null;
}

function cellQuality(key: string, value: string): number {
  const v = value.trim();
  if (!v) return 0;

  if (key.includes("percentage")) {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 0 && n <= 100 ? 10 : 2;
  }

  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  if (key.includes("yards") || key.includes("down")) return n >= 0 && n <= 999 ? 10 : 2;
  if (SMALL_ARROW_STAT_KEYS.has(key)) return n >= 0 && n <= 20 ? 8 : 3;
  return 6;
}

function mergeSide(existing: string, candidate: string, key: string): string {
  if (!candidate.trim()) return existing;
  if (!existing.trim()) return candidate;
  return cellQuality(key, candidate) > cellQuality(key, existing) ? candidate : existing;
}

function isLabelMatchedStat(stat: ParsedStat): boolean {
  return !stat.rawLabel.startsWith("(inferred");
}

function hasOffYardsGainedLabel(stats: ParsedStat[]): boolean {
  return stats.some((s) => s.key === "off_yards_gained" && isLabelMatchedStat(s));
}

function detectScrolledScreenshot(stats: ParsedStat[]): boolean {
  return !hasOffYardsGainedLabel(stats);
}

// ─── Image fetch helper ───────────────────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// ─── Main parse entry point ───────────────────────────────────────────────────

type PassResult = {
  score: ParsedScore | null;
  stats: ParsedStat[];
  warnings: string[];
  statsTopY: number;
  defaultWords: NormalizedWord[];
};

async function parseImage(buffer: Buffer, aliases: LabelAliases, variant: PreprocessVariant = "default"): Promise<PassResult> {
  const warnings: string[] = [];
  let score: ParsedScore | null = null;
  let stats: ParsedStat[] = [];
  let statsTopY = STATS_Y_MIN;
  let defaultWords: NormalizedWord[] = [];

  try {
    const defaultExtract = await extractNormalizedWords(buffer, "default");
    defaultWords = defaultExtract.words;
    const statExtract = await extractNormalizedWords(buffer, variant === "default" ? "stats" : variant);
    const leftWords = await extractLeftColumnWords(buffer);
    const rightWords = await extractRightColumnWords(buffer);

    const headerDefault = parseScoreHeader(defaultExtract.words);
    const headerStat = parseScoreHeader(statExtract.words);
    score = pickBestScore(headerDefault?.score, headerStat?.score);
    statsTopY = headerDefault?.statsTopY ?? headerStat?.statsTopY ?? STATS_Y_MIN;

    if (!score) warnings.push("Could not parse score header from this image.");

    const statWords = mergeStatWords(leftWords, rightWords, statExtract.words, defaultExtract.words, statsTopY);
    stats = fillInferredTopOffense(
      statWords,
      parseStatRows(statWords, aliases, statsTopY),
      aliases,
      statsTopY,
    );

    if (detectScrolledScreenshot(stats)) {
      warnings.push("Box score appears scrolled — scroll up so Off Yards Gained is visible.");
    }
  } catch (err) {
    warnings.push(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { score, stats, warnings, statsTopY, defaultWords };
}

// Merge a set of per-image (and per-variant) parse results into one box score.
// Stats prefer the first non-empty value found per key, so an earlier/proven
// pass wins and later passes only fill gaps.
function combineResults(results: PassResult[]): ParsedBoxScore {
  const score = pickBestScore(...results.map((r) => r.score));

  const labelSamples: Record<string, string> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      if (stat.matchedVia === "fuzzy" && stat.rawLabel && !(stat.key in labelSamples)) {
        labelSamples[stat.key] = stat.rawLabel;
      }
    }
  }

  const labelMatchedKeys = new Set<string>();
  for (const r of results) {
    for (const stat of r.stats) {
      if (isLabelMatchedStat(stat)) labelMatchedKeys.add(stat.key);
    }
  }

  const topOffenseVisible = labelMatchedKeys.has("off_yards_gained");

  const statsMap: Record<string, { team1: string; team2: string }> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      if (!topOffenseVisible && (stat.key === "off_yards_gained" || stat.key === "off_rush_yards" || stat.key === "off_pass_yards")) {
        continue;
      }
      const candidate = { team1: stat.team1, team2: stat.team2 };
      const existing = statsMap[stat.key];
      if (!existing) {
        statsMap[stat.key] = candidate;
        continue;
      }
      statsMap[stat.key] = {
        team1: mergeSide(existing.team1, candidate.team1, stat.key),
        team2: mergeSide(existing.team2, candidate.team2, stat.key),
      };
    }
  }

  // Return-yard rows can be OCR-hostile because the expander arrow sits right
  // next to a single zero. If total yards and one return-yard row are known,
  // infer the missing return cell from total = offense + punt return + kick return.
  const fillMissingReturnYards = (side: "team1" | "team2") => {
    const total = parseInt(statsMap["total_yards_gained"]?.[side] ?? "", 10);
    const off = parseInt(statsMap["off_yards_gained"]?.[side] ?? "", 10);
    const punt = statsMap["punt_return_yards"]?.[side] ?? "";
    const kick = statsMap["kick_return_yards"]?.[side] ?? "";
    if (isNaN(total) || isNaN(off)) return;
    if (!punt && kick) {
      const kickNum = parseInt(kick, 10);
      if (!isNaN(kickNum)) statsMap["punt_return_yards"] = { ...(statsMap["punt_return_yards"] ?? { team1: "", team2: "" }), [side]: String(total - off - kickNum) };
    } else if (punt && !kick) {
      const puntNum = parseInt(punt, 10);
      if (!isNaN(puntNum)) statsMap["kick_return_yards"] = { ...(statsMap["kick_return_yards"] ?? { team1: "", team2: "" }), [side]: String(total - off - puntNum) };
    }
  };
  fillMissingReturnYards("team1");
  fillMissingReturnYards("team2");

  // Off Yards Gained = Total Yards − return yards when the label row was read but a cell was blank.
  const deriveOffYardsFromTotal = (side: "team1" | "team2") => {
    if (!topOffenseVisible) return;
    const off = statsMap["off_yards_gained"]?.[side]?.trim() ?? "";
    if (off) return;
    const total = parseInt(statsMap["total_yards_gained"]?.[side] ?? "", 10);
    const punt = parseInt(statsMap["punt_return_yards"]?.[side] ?? "0", 10);
    const kick = parseInt(statsMap["kick_return_yards"]?.[side] ?? "0", 10);
    if (isNaN(total) || isNaN(punt) || isNaN(kick)) return;
    const derived = total - punt - kick;
    if (derived >= 0) {
      statsMap["off_yards_gained"] = {
        ...(statsMap["off_yards_gained"] ?? { team1: "", team2: "" }),
        [side]: String(derived),
      };
    }
  };
  if (topOffenseVisible) {
    deriveOffYardsFromTotal("team1");
    deriveOffYardsFromTotal("team2");
  }

  const deriveRushPassFromOffYards = (side: "team1" | "team2") => {
    if (!topOffenseVisible) return;
    const off = parseInt(statsMap["off_yards_gained"]?.[side] ?? "", 10);
    if (isNaN(off)) return;
    const rush = statsMap["off_rush_yards"]?.[side]?.trim() ?? "";
    const pass = statsMap["off_pass_yards"]?.[side]?.trim() ?? "";
    if (rush && !pass) {
      const r = parseInt(rush, 10);
      if (!isNaN(r) && off >= r) {
        statsMap["off_pass_yards"] = {
          ...(statsMap["off_pass_yards"] ?? { team1: "", team2: "" }),
          [side]: String(off - r),
        };
      }
    } else if (pass && !rush) {
      const p = parseInt(pass, 10);
      if (!isNaN(p) && off >= p) {
        statsMap["off_rush_yards"] = {
          ...(statsMap["off_rush_yards"] ?? { team1: "", team2: "" }),
          [side]: String(off - p),
        };
      }
    }
  };
  if (topOffenseVisible) {
    deriveRushPassFromOffYards("team1");
    deriveRushPassFromOffYards("team2");
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
    if (!hasBothSides(statsMap[key])) warnings.push(`Stat not found: ${key}`);
  }

  const missingRequired = computeMissingRequired(score, statsMap);

  return { score, stats: statsMap, warnings, missingRequired, labelSamples };
}

async function parseImageStatsPass(
  buffer: Buffer,
  aliases: LabelAliases,
  variant: "stats" | "robust",
  score: ParsedScore | null,
  statsTopY: number,
  defaultWords: NormalizedWord[],
): Promise<PassResult> {
  const statExtract = await extractNormalizedWords(buffer, variant);
  const leftWords = await extractLeftColumnWords(buffer);
  const rightWords = await extractRightColumnWords(buffer);
  const statWords = mergeStatWords(leftWords, rightWords, statExtract.words, defaultWords, statsTopY);
  return {
    score,
    stats: fillInferredTopOffense(statWords, parseStatRows(statWords, aliases, statsTopY), aliases, statsTopY),
    warnings: [],
    statsTopY,
    defaultWords,
  };
}

async function parseBoxScoreFromBuffers(buffers: Buffer[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const primaryResults = await Promise.all(buffers.map((b) => parseImage(b, aliases, "default")));
  let combined = combineResults(primaryResults);

  if (combined.missingRequired.length > 0 || hasIncompleteRequiredCell(combined.stats)) {
    const fallbackResults = await Promise.all(
      buffers.map((buffer, idx) =>
        parseImageStatsPass(
          buffer,
          aliases,
          "robust",
          primaryResults[idx].score,
          primaryResults[idx].statsTopY,
          primaryResults[idx].defaultWords,
        ),
      ),
    );
    const statsPassResults = await Promise.all(
      buffers.map((buffer, idx) =>
        parseImageStatsPass(
          buffer,
          aliases,
          "stats",
          primaryResults[idx].score,
          primaryResults[idx].statsTopY,
          primaryResults[idx].defaultWords,
        ),
      ),
    );
    combined = combineResults([...primaryResults, ...fallbackResults, ...statsPassResults]);
  }

  return combined;
}

// The single default Box Score screenshot carries every required field. Still
// accepts more than one image — a submitter can re-post when the OCR misses a
// field — and merges them, preferring the first non-empty value found per key.
export async function parseBoxScoreImages(imageUrls: string[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));
  return parseBoxScoreFromBuffers(buffers, aliases);
}

/** Local-file entry point for batch scripts and tests. */
export async function parseBoxScoreBuffers(buffers: Buffer[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  return parseBoxScoreFromBuffers(buffers, aliases);
}

// ─── Debug helper (used by scripts/box-score-diagnose.ts) ──────────────────────
// Runs one preprocessing variant against a local buffer and returns the
// processed image plus the OCR words/coords and parse, so we can see exactly
// what the parser sees for a given screenshot.
export async function debugParseBuffer(buffer: Buffer, variant: PreprocessVariant = "default") {
  const defaultExtract = await extractNormalizedWords(buffer, "default");
  const statExtract = await extractNormalizedWords(buffer, variant === "default" ? "stats" : variant);
  const leftWords = await extractLeftColumnWords(buffer);
  const rightWords = await extractRightColumnWords(buffer);
  const headerDefault = parseScoreHeader(defaultExtract.words);
  const statsTopY = headerDefault?.statsTopY ?? STATS_Y_MIN;
  const statWords = mergeStatWords(leftWords, rightWords, statExtract.words, defaultExtract.words, statsTopY);
  const stats = parseStatRows(statWords, {}, statsTopY);
  const center = statWords.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX && w.y >= statsTopY);
  const centerRows = groupIntoRows(center, LABEL_ROW_Y_TOLERANCE);
  const rowLabels = centerRows.map((row) =>
    normalizeLabel([...row].sort((a, b) => a.x - b.x).map((w) => w.text).join(" ")),
  );
  const { processed } = await preprocessImage(buffer, variant);
  return {
    processed,
    words: statWords,
    leftWordCount: leftWords.length,
    score: headerDefault?.score ?? null,
    statsTopY,
    stats,
    centerRowCount: centerRows.length,
    rowLabels,
  };
}

/** Script helper: inspect left-column OCR tokens. */
export async function debugLeftColumnWords(buffer: Buffer) {
  return extractLeftColumnWords(buffer);
}
