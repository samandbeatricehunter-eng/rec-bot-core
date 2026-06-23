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
    if (!hasValue(statsMap[key])) missing.push(FIELD_DISPLAY_NAMES[key] ?? key);
  }
  return missing;
}

// ─── Image preprocessing ─────────────────────────────────────────────────────

// "default": global threshold — fast, proven for the dark-panel upper rows.
// "robust":  local-contrast (CLAHE) pass that recovers dim text sitting over the
//            bright field background at the bottom of the screenshot, where a
//            global threshold merges light text into a light background.
export type PreprocessVariant = "default" | "robust";

async function preprocessImage(
  buffer: Buffer,
  variant: PreprocessVariant = "default",
): Promise<{ processed: Buffer; width: number; height: number }> {
  // Resize to max 1920px wide so coordinates are consistent regardless of capture resolution.
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  const targetWidth = Math.min(originalWidth, 1920);

  let pipeline = sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: true })
    .grayscale();

  if (variant === "robust") {
    // CLAHE equalizes contrast in local tiles, so dim rows over the bright field
    // get boosted relative to their own background. Negate to black-text-on-white
    // and let Tesseract binarize adaptively rather than a global threshold.
    pipeline = pipeline.clahe({ width: 128, height: 128, maxSlope: 3 }).negate();
  } else {
    pipeline = pipeline
      .normalise()            // auto-stretch contrast
      .threshold(100)         // >100 stays white (text), rest becomes black
      .negate();              // flip to black-text-on-white for Tesseract
  }

  const processed = await pipeline.png().toBuffer();
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

async function extractNormalizedWords(buffer: Buffer, variant: PreprocessVariant = "default"): Promise<{ words: NormalizedWord[]; width: number; height: number }> {
  const { processed, width, height } = await preprocessImage(buffer, variant);
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
const SCORE_ABBR_X_MIN = 0.30;
const SCORE_ABBR_X_MAX = 0.42;
const SCORE_CELL_X_TOLERANCE = 0.022;
const SCORE_QUARTER_COLUMNS = [0.432, 0.473, 0.516, 0.558, 0.601] as const;
const SCORE_TOTAL_X = 0.641;

function parseScoreToken(text: string): number | null {
  const normalized = text
    .replace(/[Oo]/g, "0")
    .replace(/^o+$/i, "0")
    .replace(/[^0-9]/g, "");
  if (!normalized) return null;
  const n = parseInt(normalized, 10);
  return isNaN(n) ? null : n;
}

function parseScoreHeader(words: NormalizedWord[]): { score: ParsedScore; statsTopY: number } | null {
  const headerWords = words.filter((w) => w.y < HEADER_Y_MAX);
  const rows = groupIntoRows(headerWords, 0.04);

  // Find rows that have numeric content (team score rows), at least 3 numbers each.
  const teamRows = rows.filter((row) => {
    const abbr = row.some((w) => /^[A-Za-z]{2,4}$/.test(w.text) && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX);
    const nums = row.filter((w) => parseScoreToken(w.text) != null && w.x > SCORE_ABBR_X_MAX);
    return abbr && nums.length >= 3;
  });

  if (teamRows.length < 2) return null;

  const parseRow = (row: NormalizedWord[]) => {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    // Team abbreviation sits in the central scoreboard band; ignore stray UI
    // text on the far left that can share the same OCR row.
    const abbrWord = sorted.find((w) => /^[A-Z]{2,4}$/.test(w.text) && w.confidence > 40 && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX);
    const abbr = abbrWord?.text ?? sorted.find((w) => /^[A-Za-z]{2,4}$/.test(w.text) && w.x >= SCORE_ABBR_X_MIN && w.x <= SCORE_ABBR_X_MAX)?.text?.toUpperCase() ?? "???";

    const valueAt = (x: number): { value: number; confidence: number } | null => {
      const candidates = sorted
        .map((w) => ({ word: w, value: parseScoreToken(w.text), dx: Math.abs(w.x - x) }))
        .filter((c): c is { word: NormalizedWord; value: number; dx: number } => c.value != null && c.dx <= SCORE_CELL_X_TOLERANCE)
        .sort((a, b) => a.dx - b.dx || b.word.confidence - a.word.confidence);
      const best = candidates[0];
      return best ? { value: best.value, confidence: best.word.confidence } : null;
    };

    const quarterCells = SCORE_QUARTER_COLUMNS.map(valueAt);
    const totalCell = valueAt(SCORE_TOTAL_X);
    const total = totalCell?.value ?? quarterCells.reduce((s, c) => s + (c?.value ?? 0), 0);
    const quarters = quarterCells.map((c) => c?.value ?? 0);

    // A scoreboard zero is sometimes OCR'd as 6. If the displayed total proves
    // exactly one quarter must be zero, zero the least-confident matching cell.
    const sum = quarters.reduce((s, n) => s + n, 0);
    if (total < sum) {
      const fix = quarterCells
        .map((cell, idx) => ({ cell, idx }))
        .filter(({ cell }) => cell && sum - cell.value === total)
        .sort((a, b) => (a.cell?.confidence ?? 100) - (b.cell?.confidence ?? 100))[0];
      if (fix) quarters[fix.idx] = 0;
    }

    return { abbr, total, quarters };
  };

  const t1 = parseRow(teamRows[0]);
  const t2 = parseRow(teamRows[1]);

  // The stats table starts just below the lowest scoreboard row. Deriving the
  // boundary from the actual scoreboard (rather than a fixed cutoff) keeps the
  // top stat rows — Off Yards Gained / Off Rush Yards — from being clipped.
  const teamRowMaxY = Math.max(...teamRows[0].map((w) => w.y), ...teamRows[1].map((w) => w.y));
  const statsTopY = teamRowMaxY + ROW_Y_TOLERANCE;

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
// Column thresholds (relative to image width).
const LEFT_VAL_X_MAX = 0.18;
const RIGHT_VAL_X_MIN = 0.82;
const CENTER_X_MIN = 0.18;
const CENTER_X_MAX = 0.82;
const ROW_Y_TOLERANCE = 0.04;

const SMALL_ARROW_STAT_KEYS = new Set([
  "turnovers",
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
  "red_zone_off_td",
  "red_zone_off_fg",
]);

function cleanStatValue(raw: string, opts: { side: "left" | "right"; key: string }): string {
  const cleaned = raw
    .replace(/[Oo]/g, "0")     // a lone 0 is frequently OCR'd as the letter O
    .replace(/^[^0-9:]+/, "")  // strip leading non-digit/colon (▶ arrows, spaces)
    .replace(/[^0-9:]+$/, "")  // strip trailing non-digit/colon (◄ arrows)
    .trim();

  // Right-side "better stat" arrows are occasionally fused into a single token
  // as a trailing 4: 0◄ -> 04, 1◄ -> 14, 2◄ -> 24.
  if (opts.side === "right" && SMALL_ARROW_STAT_KEYS.has(opts.key) && /^\d4$/.test(cleaned)) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
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

// A stat has exactly one value per column. Pick that single token rather than
// joining everything in the band (which bled in the next row's number) and pick
// the right token within the row: the value sits to the RIGHT of the ▶ expander
// in the left column, and to the LEFT of the ◄ "better stat" arrow in the right
// column — those arrows otherwise get misread as digits.
function findValueNearY(candidates: NormalizedWord[], targetY: number, side: "left" | "right", key: string): string {
  const nearby = candidates.filter((w) => Math.abs(w.y - targetY) < ROW_Y_TOLERANCE);
  if (nearby.length === 0) return "";

  // Keep only the row physically closest to the label; drop adjacent rows that
  // crept into the band.
  const minDy = Math.min(...nearby.map((w) => Math.abs(w.y - targetY)));
  const sameRow = nearby.filter((w) => Math.abs(w.y - targetY) <= minDy + 0.012);

  // Left column: value is the rightmost token (▶ is to its left).
  // Right column: value is the leftmost token (◄ is to its right).
  sameRow.sort((a, b) => (side === "left" ? b.x - a.x : a.x - b.x));

  for (const w of sameRow) {
    const v = cleanStatValue(w.text, { side, key });
    if (v) return v;
  }
  return "";
}

function parseStatRows(words: NormalizedWord[], aliases: LabelAliases, statsTopY: number = STATS_Y_MIN): ParsedStat[] {
  const statZone = words.filter((w) => w.y >= statsTopY);

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

    const team1Val = findValueNearY(leftVals, rowY, "left", match.key);
    const team2Val = findValueNearY(rightVals, rowY, "right", match.key);

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

async function parseImage(buffer: Buffer, aliases: LabelAliases, variant: PreprocessVariant = "default"): Promise<{ score: ParsedScore | null; stats: ParsedStat[]; warnings: string[] }> {
  const warnings: string[] = [];
  let score: ParsedScore | null = null;
  let stats: ParsedStat[] = [];

  try {
    const { words } = await extractNormalizedWords(buffer, variant);
    const header = parseScoreHeader(words);
    score = header?.score ?? null;
    if (!score) warnings.push("Could not parse score header from this image.");
    stats = parseStatRows(words, aliases, header?.statsTopY ?? STATS_Y_MIN);
  } catch (err) {
    warnings.push(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { score, stats, warnings };
}

type PassResult = { score: ParsedScore | null; stats: ParsedStat[]; warnings: string[] };

// Merge a set of per-image (and per-variant) parse results into one box score.
// Stats prefer the first non-empty value found per key, so an earlier/proven
// pass wins and later passes only fill gaps.
function combineResults(results: PassResult[]): ParsedBoxScore {
  // Score: first pass that yields one wins (page 1 is primary, but accept any).
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

  // Merge stats across all passes. A later pass can fill in a key that an
  // earlier pass either missed entirely or read with an empty value.
  const statsMap: Record<string, { team1: string; team2: string }> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      const candidate = { team1: stat.team1, team2: stat.team2 };
      const existing = statsMap[stat.key];
      if (!hasValue(existing) && hasValue(candidate)) {
        statsMap[stat.key] = candidate;
      } else if (!(stat.key in statsMap)) {
        statsMap[stat.key] = candidate; // keep an (empty) placeholder so the key is known
      } else if (existing) {
        statsMap[stat.key] = {
          team1: existing.team1 || candidate.team1,
          team2: existing.team2 || candidate.team2,
        };
      }
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

// The single default Box Score screenshot carries every required field. Still
// accepts more than one image — a submitter can re-post when the OCR misses a
// field — and merges them, preferring the first non-empty value found per key.
export async function parseBoxScoreImages(imageUrls: string[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));

  const defaultResults = await Promise.all(buffers.map((b) => parseImage(b, aliases, "default")));
  let combined = combineResults(defaultResults);

  // If a required field is missing OR any required cell is only half-read (one
  // side empty — always an OCR miss, since every cell has a value), re-run the
  // illumination-robust pass and merge it in. Recovers dim stats over the bright
  // field and isolated single digits, while keeping the clean case to one pass.
  if (combined.missingRequired.length > 0 || hasIncompleteRequiredCell(combined.stats)) {
    const robustResults = await Promise.all(buffers.map((b) => parseImage(b, aliases, "robust")));
    combined = combineResults([...defaultResults, ...robustResults]);
  }

  return combined;
}

// ─── Debug helper (used by scripts/box-score-diagnose.ts) ──────────────────────
// Runs one preprocessing variant against a local buffer and returns the
// processed image plus the OCR words/coords and parse, so we can see exactly
// what the parser sees for a given screenshot.
export async function debugParseBuffer(buffer: Buffer, variant: PreprocessVariant = "default") {
  const { processed } = await preprocessImage(buffer, variant);
  const { words } = await extractNormalizedWords(buffer, variant);
  const header = parseScoreHeader(words);
  const statsTopY = header?.statsTopY ?? STATS_Y_MIN;
  const stats = parseStatRows(words, {}, statsTopY);
  return { processed, words, score: header?.score ?? null, statsTopY, stats };
}
