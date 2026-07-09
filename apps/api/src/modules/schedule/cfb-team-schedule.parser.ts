import Tesseract from "tesseract.js";
import {
  fetchImageBuffer,
  flattenPageWords,
  groupIntoRows,
  preprocessImage,
  recognizeWithPool,
  type NormalizedWord,
  type PreprocessVariant,
} from "../box-score/box-score.parser.js";

// ─── CFB 27 "Team Schedule" screen parser ──────────────────────────────────────
// Reads a single team's full-season schedule (one row per week):
//   WEEK | DATE | OPPONENT (vs/at + optional AP rank + team name, or "BYE") |
//   TIME(ET)/RESULT | OPP W-L | TV | FORCE WIN
// Unlike Madden's League Schedule screen (all teams, one week), this is one team,
// every week — 1-2 screenshots (scrolled top + bottom) cover a full season. There's
// no fixed abbreviation in the OPPONENT column, just a free-text team name (which
// may be a commissioner-customized name, e.g. "Greedy Academy"), so matching is
// done by fuzzy name lookup against the league's actual current teams rather than
// an exact abbreviation match.
//
// Column bands below are a first-pass estimate from a single example screenshot,
// not yet tuned against real OCR output (no CFB fixtures existed before this file).
// The parser leans on keyword anchors ("vs"/"at"/"BYE") rather than strict x-bands
// wherever possible, since that's more resilient to imprecise band tuning than the
// Madden parser's column-band approach — but TABLE_Y_MIN/MAX and the week-label
// left band should be re-checked against real screenshots via debugTeamScheduleImage.
//
// Results (final scores) aren't parsed yet — none of the reference screenshots had
// a played game to test against. rawResult/awayScore/homeScore are carried through
// as null for every row until that can be built and verified against a real sample.

export type ParsedTeamScheduleRow = {
  /** Canonical week number in our system (0-14 regular season, 15 Conf Champ, 16-20 CFP/title). Null if unparseable. */
  weekNumber: number | null;
  /** Raw week-column text, e.g. "0", "11", "Conf Champ". */
  weekLabel: string;
  isBye: boolean;
  /** Raw opponent text with rank/vs/at stripped, e.g. "Greedy Academy". Null for BYE rows. */
  opponentRaw: string | null;
  /** AP-style rank prefix if present (e.g. "6"), otherwise null. */
  opponentRank: number | null;
  /** "home" if the row said "vs" (this team hosts); "away" if "at". Null for BYE/unparseable rows. */
  homeAway: "home" | "away" | null;
  // Not yet parsed from any known screenshot layout — see file header.
  awayScore: number | null;
  homeScore: number | null;
  rawOpponentCell: string;
  rowY: number;
};

export type ParsedTeamSchedule = {
  rows: ParsedTeamScheduleRow[];
  warnings: string[];
};

// Table rows sit below the team banner/header and above the footer button prompts.
const TABLE_Y_MIN = 0.36;
const TABLE_Y_MAX = 0.92;
const ROW_Y_TOLERANCE = 0.018;

// Week label sits in the leftmost column, well left of the DATE/OPPONENT text.
const WEEK_BAND = { min: 0.0, max: 0.16 } as const;

const SCHEDULE_VARIANTS: PreprocessVariant[] = ["stats", "robust", "default", "highlight"];

function extractWords(page: Tesseract.Page, width: number, height: number): NormalizedWord[] {
  return flattenPageWords(page)
    .filter((w) => w.text.trim().length > 0 && w.confidence > 20)
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
}

async function extractWordsForVariant(buffer: Buffer, variant: PreprocessVariant): Promise<NormalizedWord[]> {
  const { processed, width, height } = await preprocessImage(buffer, variant);
  const result = await recognizeWithPool(processed, undefined, { blocks: true });
  return extractWords(result.data, width, height);
}

function inBand(w: NormalizedWord, band: { min: number; max: number }): boolean {
  return w.x >= band.min && w.x <= band.max;
}

function rowText(row: NormalizedWord[]): string {
  return [...row].sort((a, b) => a.x - b.x).map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
}

// "0".."20" -> that number; "Conf Champ" (any casing/spacing) -> week 15 (see
// packages/shared/src/league-stage.ts for why Conf Champ lands between the regular
// season and the CFP bracket). Anything else is unparseable.
function parseWeekLabel(raw: string): { weekNumber: number | null; label: string } {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return { weekNumber: null, label: cleaned };
  if (/^conf(?:erence)?\.?\s*champ(?:ionship)?$/i.test(cleaned)) {
    return { weekNumber: 15, label: cleaned };
  }
  const m = cleaned.match(/^(\d{1,2})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return { weekNumber: n >= 0 && n <= 20 ? n : null, label: cleaned };
  }
  return { weekNumber: null, label: cleaned };
}

// Opponent cell looks like "vs 6 Greedy Academy", "at Kansas", or "BYE". Anchors on
// the vs/at keyword (or a standalone "BYE") rather than a fixed column band, since
// the preceding week-time/date text and following time/record text vary in width.
function parseOpponentCell(row: NormalizedWord[]): {
  isBye: boolean;
  opponentRaw: string | null;
  opponentRank: number | null;
  homeAway: "home" | "away" | null;
  raw: string;
} | null {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const byeIndex = sorted.findIndex((w) => /^bye$/i.test(w.text));
  if (byeIndex !== -1) {
    return { isBye: true, opponentRaw: null, opponentRank: null, homeAway: null, raw: sorted[byeIndex].text };
  }

  const anchorIndex = sorted.findIndex((w) => /^(vs\.?|at)$/i.test(w.text));
  if (anchorIndex === -1) return null;
  const homeAway: "home" | "away" = /^vs\.?$/i.test(sorted[anchorIndex].text) ? "home" : "away";

  // Everything right of the anchor, up to a word that looks like a clock time
  // ("10:30", "PM"/"AM") or a W-L record ("0-0") — that's the next column starting.
  const rest = sorted.slice(anchorIndex + 1);
  const nameWords: string[] = [];
  let opponentRank: number | null = null;
  for (const w of rest) {
    if (/^\d{1,2}:\d{2}$/.test(w.text) || /^[ap]m$/i.test(w.text) || /^\d{1,3}-\d{1,3}$/.test(w.text)) break;
    // A lone 1-2 digit number immediately after vs/at (before any name text) is an
    // AP rank, not part of the team name.
    if (nameWords.length === 0 && opponentRank === null && /^\d{1,2}$/.test(w.text)) {
      opponentRank = parseInt(w.text, 10);
      continue;
    }
    nameWords.push(w.text);
  }
  const opponentRaw = nameWords.join(" ").replace(/\s+/g, " ").trim() || null;
  return { isBye: false, opponentRaw, opponentRank, homeAway, raw: rowText(row) };
}

function parseImageRows(words: NormalizedWord[]): ParsedTeamScheduleRow[] {
  const tableWords = words.filter((w) => w.y >= TABLE_Y_MIN && w.y <= TABLE_Y_MAX);
  const rows = groupIntoRows(tableWords, ROW_Y_TOLERANCE);
  const parsed: ParsedTeamScheduleRow[] = [];

  for (const row of rows) {
    const opponent = parseOpponentCell(row);
    if (!opponent) continue; // Header/footer/noise row — no vs/at/BYE anchor found.

    const weekRaw = rowText(row.filter((w) => inBand(w, WEEK_BAND)));
    const { weekNumber, label } = parseWeekLabel(weekRaw);

    parsed.push({
      weekNumber,
      weekLabel: label,
      isBye: opponent.isBye,
      opponentRaw: opponent.opponentRaw,
      opponentRank: opponent.opponentRank,
      homeAway: opponent.homeAway,
      awayScore: null,
      homeScore: null,
      rawOpponentCell: opponent.raw,
      rowY: row.reduce((s, w) => s + w.y, 0) / row.length,
    });
  }
  return parsed;
}

// Identity for de-duping across the two scrolled screenshots.
function rowKey(row: ParsedTeamScheduleRow): string {
  return row.weekNumber != null ? `week:${row.weekNumber}` : `y:${row.rowY.toFixed(2)}`;
}

function completeness(row: ParsedTeamScheduleRow): number {
  let n = 0;
  if (row.weekNumber != null) n++;
  if (row.isBye || row.opponentRaw) n++;
  if (row.homeAway) n++;
  return n;
}

function mergeRowLists(lists: ParsedTeamScheduleRow[][]): ParsedTeamScheduleRow[] {
  const byKey = new Map<string, ParsedTeamScheduleRow>();
  for (const list of lists) {
    for (const row of list) {
      const key = rowKey(row);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const winner = completeness(row) > completeness(existing) ? row : existing;
      const other = winner === row ? existing : row;
      byKey.set(key, {
        ...winner,
        weekNumber: winner.weekNumber ?? other.weekNumber,
        opponentRaw: winner.opponentRaw ?? other.opponentRaw,
        opponentRank: winner.opponentRank ?? other.opponentRank,
        homeAway: winner.homeAway ?? other.homeAway,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.weekNumber ?? 999) - (b.weekNumber ?? 999) || a.rowY - b.rowY);
}

export async function parseTeamScheduleBuffers(buffers: Buffer[]): Promise<ParsedTeamSchedule> {
  const warnings: string[] = [];
  const lists: ParsedTeamScheduleRow[][] = [];

  for (const buffer of buffers) {
    for (const variant of SCHEDULE_VARIANTS) {
      try {
        const words = await extractWordsForVariant(buffer, variant);
        lists.push(parseImageRows(words));
      } catch (err) {
        warnings.push(`OCR error (${variant}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const rows = mergeRowLists(lists);
  if (!rows.length) warnings.push("No week rows could be read from the team schedule screenshot.");

  return { rows, warnings };
}

export async function parseTeamScheduleImages(imageUrls: string[]): Promise<ParsedTeamSchedule> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));
  return parseTeamScheduleBuffers(buffers);
}

// ─── Debug helper (mirrors schedule.parser.ts's debugScheduleImage) ────────────
export async function debugTeamScheduleImage(buffer: Buffer, variant: PreprocessVariant = "stats") {
  const words = await extractWordsForVariant(buffer, variant);
  const tableWords = words.filter((w) => w.y >= TABLE_Y_MIN && w.y <= TABLE_Y_MAX);
  const rows = groupIntoRows(tableWords, ROW_Y_TOLERANCE);
  return rows.map((row) => ({
    y: Number((row.reduce((s, w) => s + w.y, 0) / row.length).toFixed(3)),
    words: [...row].sort((a, b) => a.x - b.x).map((w) => `${w.text}@${w.x.toFixed(2)}`),
  }));
}
