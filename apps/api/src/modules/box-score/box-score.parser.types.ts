import Tesseract from "tesseract.js";

// Singleton worker — initialized once, reused across requests.
let _worker: Tesseract.Worker | null = null;
let _workerInitializing: Promise<Tesseract.Worker> | null = null;
let _ocrChain: Promise<unknown> = Promise.resolve();

export function withOcrLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _ocrChain.then(fn, fn);
  _ocrChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function getWorker(): Promise<Tesseract.Worker> {
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

export type NormalizedWord = {
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

export const STAT_LABEL_MAP: Record<string, string> = {
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

export const ALL_STAT_KEYS = new Set(Object.values(STAT_LABEL_MAP));

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

export function hasValue(v: { team1: string; team2: string } | undefined): boolean {
  return !!v && (v.team1?.trim().length > 0 || v.team2?.trim().length > 0);
}

export function hasBothSides(v: { team1: string; team2: string } | undefined): boolean {
  return !!v?.team1?.trim() && !!v?.team2?.trim();
}

// Every box-score cell always holds a value (negative, 0, or positive), so an
// empty side of a required stat is always an OCR miss worth a second read.
export function hasIncompleteRequiredCell(statsMap: Record<string, { team1: string; team2: string }>): boolean {
  return REQUIRED_STAT_KEYS.some((key) => {
    const v = statsMap[key];
    return !v || !v.team1?.trim() || !v.team2?.trim();
  });
}

export function computeMissingRequired(
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

// ─── Cross-cutting layout constants ──────────────────────────────────────────
// Shared by word extraction, score-header parsing, and stats-table parsing —
// kept here to avoid circular imports between those sibling modules.

// Stat value column thresholds (also used when filtering low-confidence digits).
export const LEFT_VAL_X_MAX = 0.20;
export const RIGHT_VAL_X_MIN = 0.80;

// Fallback start of the stats table, used only when the scoreboard can't be
// located. Normally the boundary is derived dynamically from the scoreboard's
// lowest row (see parseScoreHeader) so the top stat rows aren't clipped.
export const STATS_Y_MIN = 0.28;
