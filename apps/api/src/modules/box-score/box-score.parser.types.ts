import Tesseract from "tesseract.js";

// Pooled Tesseract workers behind a Scheduler — recognizeWithPool() dispatches to
// whichever worker is free, so concurrent box-score uploads across leagues run OCR
// in parallel (bounded by pool size) instead of serializing one-at-a-time behind a
// single worker. Pool size is intentionally small: each worker is a real Tesseract
// process/thread, so this trades memory for throughput.
const OCR_POOL_SIZE = Number(process.env.OCR_WORKER_POOL_SIZE ?? 3);

let _scheduler: Tesseract.Scheduler | null = null;
let _schedulerInitializing: Promise<Tesseract.Scheduler> | null = null;

async function getScheduler(): Promise<Tesseract.Scheduler> {
  if (_scheduler) return _scheduler;
  if (_schedulerInitializing) return _schedulerInitializing;
  _schedulerInitializing = (async () => {
    const scheduler = Tesseract.createScheduler();
    const workers = await Promise.all(
      Array.from({ length: Math.max(1, OCR_POOL_SIZE) }, () => Tesseract.createWorker("eng")),
    );
    for (const worker of workers) scheduler.addWorker(worker);
    _scheduler = scheduler;
    _schedulerInitializing = null;
    return scheduler;
  })();
  return _schedulerInitializing;
}

export async function recognizeWithPool(
  ...args: Parameters<Tesseract.Worker["recognize"]>
): Promise<Tesseract.RecognizeResult> {
  const scheduler = await getScheduler();
  return scheduler.addJob("recognize", ...args);
}

export async function terminateTesseractWorker() {
  if (_scheduler) {
    await _scheduler.terminate();
    _scheduler = null;
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
