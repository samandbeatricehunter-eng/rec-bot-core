// CFB (College Football 27) box-score OCR parser.
//
// This is a completely different screen from Madden NFL's box-score UI, so it gets
// its own parser rather than branching inside box-score.parser.ts: two team panels
// flank a center scoreboard grid (1/2/3/4/OT/Final columns), and the stat table below
// uses composite cells — "29-137-3" (Rushes-Yards-TDs), "14-23-1" (Comp-Att-TDs),
// "3-0-50%" (Red Zone TD-FG-%), "1-47.0" (Punts-Avg), "1-5" (Penalties-Yards),
// "16:22" (T.O.P.) — instead of Madden's one-number-per-cell layout.
//
// The "Box Score" tab is one continuous scrollable list of 23 rows (Score through
// T.O.P.); two screenshots are required to cover it, overlapping by exactly one row
// (4th Down Conv.). Row order never changes, and row spacing is a near-constant
// ~0.0425 of image height (calibrated from test-fixtures/box-scores/cfb/{1,2}.jpg),
// so rows are located by interpolating from whichever labels OCR read cleanly rather
// than requiring every label to match — much more robust than label-only matching
// given how often a single row's label goes unread.
//
// Canonical stat keys are reused from the NFL label map wherever a CFB stat is
// semantically identical (off_yards_gained, off_rush_yards, off_pass_yards,
// off_first_down, punt_return_yards, kick_return_yards, total_yards_gained,
// turnovers, red_zone_off_percentage, third/fourth_down/two_point conversions) so
// the same REQUIRED_STAT_KEYS gate, badge engine, and EOS payout stat lookups work
// unmodified. CFB-only stats (total plays, yards/play, rush attempts/TDs, comp/att/
// pass TDs, yards/rush, yards/pass, fumbles lost, interceptions thrown, red zone
// TD/FG counts, punts, punt avg, penalties, penalty yards, time of possession) get
// new keys and are captured best-effort but aren't required or read by badges yet.
import sharp from "sharp";
import {
  dedupeWords,
  extractLeftColumnWords,
  extractNormalizedWords,
  extractRightColumnWords,
  flattenPageWords,
  groupIntoRows,
} from "./box-score.parser.ocr.js";
import { fetchImageBuffer } from "./box-score.parser.js";
import {
  computeMissingRequired,
  recognizeWithPool,
  type LabelAliases,
  type NormalizedWord,
  type ParsedBoxScore,
  type ParsedScore,
} from "./box-score.parser.types.js";

type StatSide = "team1" | "team2";
type StatsMap = Record<string, { team1: string; team2: string }>;

function setStat(map: StatsMap, key: string, side: StatSide, value: string) {
  if (!value) return;
  const existing = map[key] ?? { team1: "", team2: "" };
  existing[side] = value;
  map[key] = existing;
}

// ─── Label normalization ────────────────────────────────────────────────────

function normalizeCfbLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/t0p/g, "top")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelMatches(normalized: string, anchor: string): boolean {
  return anchor.length >= 5 ? normalized.includes(anchor) : normalized === anchor;
}

// ─── Composite-cell parsing ──────────────────────────────────────────────────

// Picks the longest digit run rather than the first — a stray single-digit noise
// token that lands in the value band ahead of the real (usually multi-digit) value
// would otherwise win by being first in reading order.
function parseSimple(raw: string): string | null {
  const matches = raw.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return null;
  return matches.reduce((best, m) => (m.replace(/[^0-9]/g, "").length > best.replace(/[^0-9]/g, "").length ? m : best));
}

// "29-137-3" -> [attempts, yards, tds]. OCR sometimes drops the middle hyphen,
// fusing yards+TD digits (e.g. "21-271" for the true "21-27-1") — the TD count is
// always a single trailing digit, so recover it by peeling the last digit off.
function parseTriple(raw: string): [string, string, string] | null {
  const cleaned = raw.replace(/\s+/g, "").replace(/%$/, "");
  const full = cleaned.match(/^(-?\d+)-(-?\d+)-(-?\d+)$/);
  if (full) return [full[1], full[2], full[3]];
  // Cap at 3 digits: a legitimate fused pair is "yards+TD" (up to 3-digit yards) or
  // "attempts+TD" (2-digit attempts) collapsed together. A 4+-digit second group
  // means an extra noise digit got mixed in — safer to report nothing than a wrong
  // guess (e.g. "14-2341" for the true "14-23-1" must not become attempts=234).
  const fused = cleaned.match(/^(-?\d+)-(-?\d+)$/);
  if (fused && fused[2].length >= 2 && fused[2].length <= 3) {
    return [fused[1], fused[2].slice(0, -1), fused[2].slice(-1)];
  }
  return null;
}

// Rushes-Yards-TDs specific: OCR occasionally drops BOTH hyphens (e.g. "21271" for
// the true "21-27-1"). TD count is reliably a single trailing digit and rush
// attempts for a full game are reliably two digits, so peel from both ends.
// Not reused for Comp-Att-TDs — completions can legitimately be a single digit,
// making the two-digit assumption unsafe there.
function parseRushTripleBare(cleaned: string): [string, string, string] | null {
  const bare = cleaned.match(/^(\d{4,6})$/);
  if (!bare) return null;
  const digits = bare[1];
  const attempts = digits.slice(0, 2);
  const td = digits.slice(-1);
  const middle = digits.slice(2, -1);
  return middle.length >= 1 ? [attempts, middle, td] : null;
}

function parsePair(raw: string): [string, string] | null {
  const cleaned = raw.replace(/\s+/g, "");
  const m = cleaned.match(/^(-?\d+)-(-?\d+(?:\.\d+)?)$/);
  return m ? [m[1], m[2]] : null;
}

// "5-9 (55%)" -> "5/9", matching the format the NFL parser already uses for the
// same canonical keys (third/fourth_down_conversions, two_point_conversions).
function parseConversion(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "");
  const m = cleaned.match(/^(\d+)-(\d+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function parseClock(raw: string): number | null {
  const m = raw.match(/(\d+):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ─── Row model ───────────────────────────────────────────────────────────────
// Fixed order, index 0-22, matching the CFB Box Score tab's scroll order exactly.

type RowDef = {
  index: number;
  anchors: string[];
  apply: (raw: string, side: StatSide, map: StatsMap) => void;
};

const ROW_DEFS: RowDef[] = [
  { index: 0, anchors: ["score"], apply: () => {} }, // handled separately — feeds ParsedScore, not statsMap
  { index: 1, anchors: ["first down"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "off_first_down", side, v); } },
  { index: 2, anchors: ["total offense"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "off_yards_gained", side, v); } },
  { index: 3, anchors: ["total plays"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "total_plays", side, v); } },
  { index: 4, anchors: ["yards per play"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "yards_per_play", side, v); } },
  {
    index: 5,
    anchors: ["rushes"],
    apply: (raw, side, map) => {
      const t = parseTriple(raw) ?? parseRushTripleBare(raw.replace(/\s+/g, ""));
      if (!t) return;
      setStat(map, "off_rush_attempts", side, t[0]);
      setStat(map, "off_rush_yards", side, t[1]);
      setStat(map, "off_rush_tds", side, t[2]);
    },
  },
  { index: 6, anchors: ["yards per rush"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "yards_per_rush", side, v); } },
  {
    index: 7,
    anchors: ["comp"],
    apply: (raw, side, map) => {
      const t = parseTriple(raw);
      if (!t) return;
      setStat(map, "pass_completions", side, t[0]);
      setStat(map, "pass_attempts", side, t[1]);
      setStat(map, "off_pass_tds", side, t[2]);
    },
  },
  { index: 8, anchors: ["yards per pass"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "yards_per_pass", side, v); } },
  { index: 9, anchors: ["passing yards"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "off_pass_yards", side, v); } },
  { index: 10, anchors: ["3rd down", "third down"], apply: (raw, side, map) => { const v = parseConversion(raw); if (v) setStat(map, "third_down_conversions", side, v); } },
  { index: 11, anchors: ["4th down", "fourth down"], apply: (raw, side, map) => { const v = parseConversion(raw); if (v) setStat(map, "fourth_down_conversions", side, v); } },
  { index: 12, anchors: ["2 point", "two point"], apply: (raw, side, map) => { const v = parseConversion(raw); if (v) setStat(map, "two_point_conversions", side, v); } },
  {
    index: 13,
    anchors: ["red zone"],
    apply: (raw, side, map) => {
      const t = parseTriple(raw);
      if (!t) return;
      setStat(map, "red_zone_tds", side, t[0]);
      setStat(map, "red_zone_fgs", side, t[1]);
      setStat(map, "red_zone_off_percentage", side, t[2]);
    },
  },
  { index: 14, anchors: ["turnovers"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "turnovers", side, v); } },
  { index: 15, anchors: ["fumble"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "fumbles_lost", side, v); } },
  { index: 16, anchors: ["interceptions"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "interceptions_thrown", side, v); } },
  { index: 17, anchors: ["pr yards"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "punt_return_yards", side, v); } },
  { index: 18, anchors: ["kr yards"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "kick_return_yards", side, v); } },
  { index: 19, anchors: ["total yards"], apply: (raw, side, map) => { const v = parseSimple(raw); if (v) setStat(map, "total_yards_gained", side, v); } },
  {
    index: 20,
    anchors: ["punts"],
    apply: (raw, side, map) => {
      const p = parsePair(raw);
      if (!p) return;
      setStat(map, "punts", side, p[0]);
      setStat(map, "punt_avg_yards", side, p[1]);
    },
  },
  {
    index: 21,
    anchors: ["penalties"],
    apply: (raw, side, map) => {
      const p = parsePair(raw);
      if (!p) return;
      setStat(map, "penalties", side, p[0]);
      setStat(map, "penalty_yards", side, p[1]);
    },
  },
  { index: 22, anchors: ["top", "time of possession"], apply: (raw, side, map) => { const s = parseClock(raw); if (s != null) setStat(map, "time_of_possession_seconds", side, String(s)); } },
];

const DEFAULT_ROW_STEP = 0.0425;
const ROW_Y_TOLERANCE = 0.016;

// Center label column: labels sit at x ~0.47-0.54. A recurring decorative glyph at
// x~0.409-0.41 (misread as "<4"/"4") pollutes anything wider, so keep the band tight.
const LABEL_X_MIN = 0.44;
const LABEL_X_MAX = 0.66;
const LABEL_ROW_Y_TOLERANCE = 0.014;

// Value columns: left (team1/away) ~0.11-0.18, right (team2/home) ~0.82-0.90.
const LEFT_VAL_X_MIN = 0.11;
const LEFT_VAL_X_MAX = 0.18;
const RIGHT_VAL_X_MIN = 0.82;
const RIGHT_VAL_X_MAX = 0.9;

const STATS_ZONE_MIN_Y = 0.4;

function rowAvgY(row: NormalizedWord[]): number {
  return row.reduce((s, w) => s + w.y, 0) / row.length;
}

// Locate each of the 23 fixed rows by interpolating from whichever labels this
// image's OCR pass actually read cleanly, rather than requiring every row's label
// to match — a screenshot only ever needs 1-2 confident anchors to place the rest.
function locateRows(words: NormalizedWord[]): Map<number, number> {
  const centerWords = words.filter((w) => w.x >= LABEL_X_MIN && w.x <= LABEL_X_MAX && w.y >= STATS_ZONE_MIN_Y);
  const centerRows = groupIntoRows(centerWords, LABEL_ROW_Y_TOLERANCE);

  const anchors: { index: number; y: number }[] = [];
  for (const row of centerRows) {
    const normalized = normalizeCfbLabel([...row].sort((a, b) => a.x - b.x).map((w) => w.text).join(" "));
    if (!normalized) continue;
    const y = rowAvgY(row);
    for (const def of ROW_DEFS) {
      if (anchors.some((a) => a.index === def.index)) continue;
      if (def.anchors.some((a) => labelMatches(normalized, a))) {
        anchors.push({ index: def.index, y });
        break;
      }
    }
  }

  if (!anchors.length) return new Map();
  anchors.sort((a, b) => a.index - b.index);

  let step = DEFAULT_ROW_STEP;
  if (anchors.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < anchors.length; i++) {
      const indexDiff = anchors[i].index - anchors[i - 1].index;
      if (indexDiff > 0) deltas.push((anchors[i].y - anchors[i - 1].y) / indexDiff);
    }
    if (deltas.length) {
      deltas.sort((a, b) => a - b);
      step = deltas[Math.floor(deltas.length / 2)];
    }
  }

  const positions = new Map<number, number>();
  for (const def of ROW_DEFS) {
    const nearest = anchors.reduce((best, a) =>
      Math.abs(a.index - def.index) < Math.abs(best.index - def.index) ? a : best,
    anchors[0]);
    positions.set(def.index, nearest.y + (def.index - nearest.index) * step);
  }
  return positions;
}

// Join same-row value tokens preserving punctuation (composite cells need the
// hyphens/colons/percent signs) while dropping pure-noise glyphs (arrows, stray
// marks) that carry no digits.
function valueAt(words: NormalizedWord[], rowY: number, xMin: number, xMax: number): string {
  const band = words
    .filter((w) => w.x >= xMin && w.x <= xMax && Math.abs(w.y - rowY) <= ROW_Y_TOLERANCE && /\d/.test(w.text))
    .sort((a, b) => a.x - b.x);
  if (!band.length) return "";

  let out = "";
  let prevX1: number | null = null;
  for (const w of band) {
    const cleaned = w.text.replace(/[Oo]/g, "0");
    if (prevX1 != null && w.x0 - prevX1 > 0.012) out += " ";
    out += cleaned;
    prevX1 = w.x1;
  }
  return out.replace(/[^0-9%().:/\-\s]/g, "").replace(/\s+/g, " ").trim();
}

// ─── Score header (best-effort quarters; final score comes from the "Score" row) ──

const HEADER_AWAY_Y = { min: 0.25, max: 0.31 };
const HEADER_HOME_Y = { min: 0.315, max: 0.36 };
// Quarter/OT/Final columns sit somewhere past the team seed number/mini-badge (x<0.4)
// and before the home team's panel border (x>0.75) — wide enough to catch every
// layout below.
const HEADER_ROW_X_MIN = 0.4;
const HEADER_ROW_X_MAX = 0.75;
// Columns aren't at fixed x fractions: whether the game went to OT changes how many
// columns (4 quarters, or 4 quarters + OT) share the same header width, which shifts
// every quarter column's x position rightward compared to an OT box score — a fixed
// per-column x lookup calibrated from one layout silently reads zero columns from the
// other. Cluster the digits that are actually present into columns instead, the same
// "locate real anchors, don't assume fixed positions" approach locateRows already
// uses for the stat table's rows.
const HEADER_COLUMN_CLUSTER_GAP = 0.025;

function clusterColumnXs(words: NormalizedWord[]): number[] {
  const xs = words
    .filter((w) => w.x >= HEADER_ROW_X_MIN && w.x <= HEADER_ROW_X_MAX && /\d/.test(w.text))
    .map((w) => w.x)
    .sort((a, b) => a - b);
  const columns: number[] = [];
  for (const x of xs) {
    const last = columns[columns.length - 1];
    if (last == null || x - last > HEADER_COLUMN_CLUSTER_GAP) columns.push(x);
  }
  return columns;
}

function readHeaderRow(words: NormalizedWord[], yMin: number, yMax: number, columnXs: number[]): number[] {
  const row = words.filter((w) => w.y >= yMin && w.y <= yMax);
  return columnXs.map((x) => {
    const candidates = row
      .filter((w) => Math.abs(w.x - x) <= HEADER_COLUMN_CLUSTER_GAP && /\d/.test(w.text))
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
    const digits = candidates[0]?.text.replace(/[Oo]/g, "0").replace(/\D/g, "") ?? "";
    if (!digits) return 0;
    const n = parseInt(digits.slice(0, 2), 10);
    return isNaN(n) || n > 59 ? 0 : n;
  });
}

function scoreLooksPlausible(score: { team1: number; team2: number } | null) {
  return Boolean(score && score.team1 >= 0 && score.team2 >= 0 && score.team1 <= 99 && score.team2 <= 99);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function headerHasCoherentQuarters(header: { finalScore: { team1: number; team2: number } | null; team1Quarters: number[]; team2Quarters: number[] }) {
  if (!header.finalScore || header.team1Quarters.length < 4 || header.team2Quarters.length < 4) return false;
  return Math.abs(sum(header.team1Quarters) - header.finalScore.team1) <= 3
    && Math.abs(sum(header.team2Quarters) - header.finalScore.team2) <= 3;
}

// Reads the center scoreboard header (quarters + Final). This is independent from the
// "Score" stat row below the header, because in real screenshots one of those sources can
// OCR cleanly while the other misses or swaps digits.
function parseHeaderScoreboard(words: NormalizedWord[]): { finalScore: { team1: number; team2: number } | null; team1Quarters: number[]; team2Quarters: number[] } {
  // Both team rows share the same column positions, so pool digits from both when
  // locating columns — a column only one side actually scored in (e.g. a shutout
  // quarter for the other team) still gets located correctly.
  const headerWords = words.filter((w) => w.y >= HEADER_AWAY_Y.min && w.y <= HEADER_HOME_Y.max);
  const columnXs = clusterColumnXs(headerWords);
  if (columnXs.length < 5) return { finalScore: null, team1Quarters: [], team2Quarters: [] };

  const quarterColumnXs = columnXs.slice(0, -1);
  const finalColumnX = columnXs[columnXs.length - 1];
  const team1Quarters = readHeaderRow(words, HEADER_AWAY_Y.min, HEADER_AWAY_Y.max, quarterColumnXs);
  const team2Quarters = readHeaderRow(words, HEADER_HOME_Y.min, HEADER_HOME_Y.max, quarterColumnXs);
  const [team1FinalRaw] = readHeaderRow(words, HEADER_AWAY_Y.min, HEADER_AWAY_Y.max, [finalColumnX]);
  const [team2FinalRaw] = readHeaderRow(words, HEADER_HOME_Y.min, HEADER_HOME_Y.max, [finalColumnX]);
  const quarterSum1 = sum(team1Quarters);
  const quarterSum2 = sum(team2Quarters);

  // If the final column is missing or obviously inconsistent, fall back to the quarter
  // sums. If it matches, keep the displayed final column.
  const team1Final = team1FinalRaw && Math.abs(team1FinalRaw - quarterSum1) <= 3 ? team1FinalRaw : quarterSum1;
  const team2Final = team2FinalRaw && Math.abs(team2FinalRaw - quarterSum2) <= 3 ? team2FinalRaw : quarterSum2;
  const finalScore = scoreLooksPlausible({ team1: team1Final, team2: team2Final }) ? { team1: team1Final, team2: team2Final } : null;

  return { finalScore, team1Quarters, team2Quarters };
}

// Best-effort only — if the summed quarters don't roughly match the final score, discard
// the quarter breakdown rather than show misleading partial data.
function reconcileHeaderQuarters(header: { team1Quarters: number[]; team2Quarters: number[] }, team1Final: number, team2Final: number): { team1Quarters: number[]; team2Quarters: number[] } {
  if (header.team1Quarters.length < 4 || header.team2Quarters.length < 4) return { team1Quarters: [], team2Quarters: [] };
  const sum1 = sum(header.team1Quarters);
  const sum2 = sum(header.team2Quarters);
  if (Math.abs(sum1 - team1Final) > 3 || Math.abs(sum2 - team2Final) > 3) {
    return { team1Quarters: [], team2Quarters: [] };
  }
  return header;
}

// ─── Team name panels ─────────────────────────────────────────────────────────
// CFB shows full school/mascot names (and a seed number + possibly a relocated
// display city/nick), never a short abbreviation like Madden's scoreboard — so
// there's nothing to slot into the NFL parser's 2-4 letter abbr matching. Grab
// every alpha token in each side's panel instead and hand the raw blob to a
// fuzzy name matcher downstream (box-score.service.ts, via team-name-match.ts)
// rather than trying to parse a clean single name out of a multi-line, often
// low-confidence OCR read.

const TEAM_NAME_PANEL_Y = { min: 0.24, max: 0.4 };
const AWAY_PANEL_X_MAX = 0.2;
const HOME_PANEL_X_MIN = 0.8;

function extractPanelName(words: NormalizedWord[], xTest: (x: number) => boolean): string {
  const panelWords = words
    .filter((w) => xTest(w.x) && w.y >= TEAM_NAME_PANEL_Y.min && w.y <= TEAM_NAME_PANEL_Y.max && /[A-Za-z]{2,}/.test(w.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of panelWords) {
    const t = w.text.trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join(" ");
}

// ─── Score row targeted crop ──────────────────────────────────────────────────
// The Score row's digits ("59", "14") are dark text on a bright highlighted bar —
// every other row is light text on a dark panel. Neither the full-frame passes nor
// the wide (32%-of-image-width) left/right column crops reliably resolve that one
// row: at that scale the row is a thin sliver of a much larger crop, too small
// relative to the crop to binarize cleanly. Once the other (reliably-read) rows
// have located roughly where row 0 sits, crop tightly around just that row's value
// bands and re-OCR at a much higher effective zoom — the same trick that fixed a
// hand-picked crop of just this row in calibration.
const SCORE_ROW_Y_PAD = 0.03;
const SCORE_ROW_BANDS: { xMin: number; xMax: number }[] = [
  { xMin: LEFT_VAL_X_MIN - 0.04, xMax: LEFT_VAL_X_MAX + 0.06 },
  { xMin: RIGHT_VAL_X_MIN - 0.06, xMax: RIGHT_VAL_X_MAX + 0.04 },
];

async function extractScoreRowWords(buffer: Buffer, rowY: number): Promise<NormalizedWord[]> {
  const resized = await sharp(buffer)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(1920, undefined, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const actualWidth = meta.width ?? 1920;
  const actualHeight = meta.height ?? 1080;

  const out: NormalizedWord[] = [];
  for (const band of SCORE_ROW_BANDS) {
    const left = Math.max(0, Math.round(actualWidth * band.xMin));
    const right = Math.min(actualWidth, Math.round(actualWidth * band.xMax));
    const top = Math.max(0, Math.round(actualHeight * (rowY - SCORE_ROW_Y_PAD)));
    const bottom = Math.min(actualHeight, Math.round(actualHeight * (rowY + SCORE_ROW_Y_PAD)));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) continue;

    const crop = await sharp(resized).extract({ left, top, width, height }).toBuffer();
    // No normalise/CLAHE — dark-text-on-light-bar is already the polarity Tesseract
    // expects, and redistributing the histogram is what loses thin strokes like "1".
    const processed = await sharp(crop).grayscale().threshold(180).resize(width * 4, height * 4, { fit: "fill" }).png().toBuffer();
    const result = await recognizeWithPool(processed, undefined, { blocks: true });

    for (const w of flattenPageWords(result.data)) {
      const text = w.text.trim();
      if (!text) continue;
      const cx = (w.bbox.x0 + w.bbox.x1) / 2 / (width * 4);
      const cy = (w.bbox.y0 + w.bbox.y1) / 2 / (height * 4);
      const x = band.xMin + cx * (band.xMax - band.xMin);
      const y = (rowY - SCORE_ROW_Y_PAD) + cy * (2 * SCORE_ROW_Y_PAD);
      out.push({ text, confidence: w.confidence, x, y, x0: x, x1: x, y0: y, y1: y });
    }
  }
  return out;
}

// ─── Per-image parse pass ─────────────────────────────────────────────────────

type CfbPassResult = {
  finalScore: { team1: number; team2: number } | null;
  quarters: { team1Quarters: number[]; team2Quarters: number[] } | null;
  stats: StatsMap;
  words: NormalizedWord[];
  team1NameRaw: string;
  team2NameRaw: string;
};

async function parseCfbImage(buffer: Buffer): Promise<CfbPassResult> {
  // Merge several preprocessing passes — "default" (global threshold) reads most
  // labels cleanly, "stats" (CLAHE) recovers dimmer stat digits the global threshold
  // crushes, "highlight" (high cutoff, isolates the brightest pixels) helps with
  // some bright-row cases, and the dedicated left/right column crops (higher zoom,
  // column-specific preprocessing) recover edge-of-frame value-column digits that
  // the full-frame passes sometimes split into unusable fragments. No single pass
  // alone had full recall in calibration against the CFB test-fixture screenshots.
  const [defaultPass, statsPass, highlightPass, leftWords, rightWords] = await Promise.all([
    extractNormalizedWords(buffer, "default"),
    extractNormalizedWords(buffer, "stats"),
    extractNormalizedWords(buffer, "highlight"),
    extractLeftColumnWords(buffer),
    extractRightColumnWords(buffer),
  ]);
  let words = dedupeWords([...defaultPass.words, ...statsPass.words, ...highlightPass.words, ...leftWords, ...rightWords]);
  let positions = locateRows(words);

  // The Score row is the one row in the table that's dark text on a bright
  // highlighted bar (every other row is light text on a dark panel) — none of the
  // above passes reliably resolve it at their scale. Once the other rows have
  // located roughly where row 0 sits, re-OCR just that row's value bands at a much
  // higher effective zoom and fold the result back in before reading any values.
  const estimatedScoreRowY = positions.get(0);
  if (estimatedScoreRowY != null) {
    const scoreRowWords = await extractScoreRowWords(buffer, estimatedScoreRowY);
    if (scoreRowWords.length) {
      words = dedupeWords([...words, ...scoreRowWords]);
      positions = locateRows(words);
    }
  }

  const stats: StatsMap = {};
  let scoreRowFinal: { team1: number; team2: number } | null = null;

  for (const def of ROW_DEFS) {
    const rowY = positions.get(def.index);
    if (rowY == null) continue;
    const left = valueAt(words, rowY, LEFT_VAL_X_MIN, LEFT_VAL_X_MAX);
    const right = valueAt(words, rowY, RIGHT_VAL_X_MIN, RIGHT_VAL_X_MAX);

    if (def.index === 0) {
      const t1 = parseSimple(left);
      const t2 = parseSimple(right);
      if (t1 && t2) scoreRowFinal = { team1: parseInt(t1, 10), team2: parseInt(t2, 10) };
      continue;
    }
    if (left) def.apply(left, "team1", stats);
    if (right) def.apply(right, "team2", stats);
  }

  const headerScoreboard = parseHeaderScoreboard(words);
  const finalScore = headerHasCoherentQuarters(headerScoreboard)
    ? headerScoreboard.finalScore
    : scoreLooksPlausible(scoreRowFinal) ? scoreRowFinal : headerScoreboard.finalScore;
  const quarters = finalScore ? reconcileHeaderQuarters(headerScoreboard, finalScore.team1, finalScore.team2) : null;
  const team1NameRaw = extractPanelName(words, (x) => x < AWAY_PANEL_X_MAX);
  const team2NameRaw = extractPanelName(words, (x) => x > HOME_PANEL_X_MIN);
  return { finalScore, quarters, stats, words, team1NameRaw, team2NameRaw };
}

// ─── Derivations (mirrors the NFL parser's arithmetic-recovery tricks) ──────────

function deriveTotalYards(stats: StatsMap) {
  const off = stats["off_yards_gained"];
  const pr = stats["punt_return_yards"];
  const kr = stats["kick_return_yards"];
  for (const side of ["team1", "team2"] as const) {
    if (stats["total_yards_gained"]?.[side]?.trim()) continue;
    const offN = parseInt(off?.[side] ?? "", 10);
    const prN = parseInt(pr?.[side] ?? "", 10);
    const krN = parseInt(kr?.[side] ?? "", 10);
    if (isNaN(offN) || isNaN(prN) || isNaN(krN)) continue;
    setStat(stats, "total_yards_gained", side, String(offN + prN + krN));
  }
}

function deriveRedZoneDefense(stats: StatsMap) {
  const offPct = stats["red_zone_off_percentage"];
  if (!offPct) return;
  const t1 = parseInt(offPct.team1, 10);
  const t2 = parseInt(offPct.team2, 10);
  if (!isNaN(t2)) setStat(stats, "red_zone_def_percentage", "team1", String(100 - t2));
  if (!isNaN(t1)) setStat(stats, "red_zone_def_percentage", "team2", String(100 - t1));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function parseCfbBoxScoreImages(imageUrls: string[], _aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));
  return parseCfbBoxScoreBuffers(buffers);
}

/** Local-file entry point for calibration/debug scripts. */
export async function parseCfbBoxScoreBuffers(buffers: Buffer[]): Promise<ParsedBoxScore> {
  const results = await Promise.all(buffers.map(parseCfbImage));

  const stats: StatsMap = {};
  let finalScore: { team1: number; team2: number } | null = null;
  let quarters: { team1Quarters: number[]; team2Quarters: number[] } | null = null;
  let team1NameRaw = "";
  let team2NameRaw = "";

  for (const r of results) {
    for (const [key, val] of Object.entries(r.stats)) {
      if (val.team1 && !stats[key]?.team1) setStat(stats, key, "team1", val.team1);
      if (val.team2 && !stats[key]?.team2) setStat(stats, key, "team2", val.team2);
    }
    if (!finalScore && r.finalScore) finalScore = r.finalScore;
    if (!quarters && r.quarters && (r.quarters.team1Quarters.length || r.quarters.team2Quarters.length)) {
      quarters = r.quarters;
    }
    // Both screenshots show the same header — keep whichever pass captured more text.
    if (r.team1NameRaw.length > team1NameRaw.length) team1NameRaw = r.team1NameRaw;
    if (r.team2NameRaw.length > team2NameRaw.length) team2NameRaw = r.team2NameRaw;
  }

  deriveTotalYards(stats);
  deriveRedZoneDefense(stats);

  const warnings: string[] = [];
  if (!finalScore) warnings.push("Could not parse the final score from these images.");

  // team1Abbr/team2Abbr hold a raw multi-word OCR blob here, not a real abbreviation
  // — CFB never displays one. box-score.service.ts's CFB-aware team resolution
  // fuzzy-matches this blob against team name/mascot/display-city+nick instead of
  // the NFL abbreviation matcher. Falls back to "???" (unmatchable) if OCR found
  // nothing at all in either team's panel.
  const score: ParsedScore | null = finalScore
    ? {
        team1Abbr: team1NameRaw || "???",
        team2Abbr: team2NameRaw || "???",
        team1Score: finalScore.team1,
        team2Score: finalScore.team2,
        team1Quarters: quarters?.team1Quarters ?? [],
        team2Quarters: quarters?.team2Quarters ?? [],
      }
    : null;

  const missingRequired = computeMissingRequired(score, stats);
  return { score, stats, warnings, missingRequired, labelSamples: {} };
}
