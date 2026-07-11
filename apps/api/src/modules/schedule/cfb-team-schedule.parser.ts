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
// The parser leans on keyword anchors ("vs"/"at"/"BYE") rather than fixed column x-bands —
// the week label is read off whatever the leftmost token(s) in a row are (relative to the
// opponent anchor), not a guessed x-fraction, since a wrong band silently produces an empty
// label for every row instead of an obviously-wrong one. TABLE_Y_MIN/MAX (which rows count as
// "the table") is still a fixed estimate and may need adjusting against real screenshots via
// debugTeamScheduleImage. A row that produces no recognizable week number is still kept (not
// dropped) with its raw OCR text preserved, and a sample of those gets surfaced in `warnings` —
// so a bad parse is diagnosable from the response itself instead of just vanishing.
//
// Results (final scores) aren't parsed yet — none of the reference screenshots had
// a played game to test against. awayScore/homeScore are carried through as null for every
// row until that can be built and verified against a real sample.

export type ParsedTeamScheduleRow = {
  /** Canonical week number in our system (0-14 regular season, 15 Conf Champ, 16-20 CFP/title). Null if unparseable. */
  weekNumber: number | null;
  /** Raw week-column text, e.g. "0", "11", "Conf Champ". */
  weekLabel: string;
  isBye: boolean;
  /** Raw opponent text with rank/vs/at stripped, e.g. "Greedy Academy". Null for BYE rows or if unparseable. */
  opponentRaw: string | null;
  /** AP-style rank prefix if present (e.g. "6"), otherwise null. */
  opponentRank: number | null;
  /** "home" if the row said "vs" (this team hosts); "away" if "at". Null for BYE/unparseable rows. */
  homeAway: "home" | "away" | null;
  // Not yet parsed from any known screenshot layout — see file header.
  awayScore: number | null;
  homeScore: number | null;
  /** Full row text as OCR read it — always populated, even when nothing else could be parsed, so a failed row is diagnosable instead of silently vanishing. */
  rawRowText: string;
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

const DAY_OF_WEEK = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?$/i;

// Week label sits to the left of the DATE cell ("Fri, Sep 4"), which itself starts with a
// weekday abbreviation — a much more reliable anchor than "leftmost token", because there's
// often a stray OCR artifact (a misread row-highlight icon, e.g. "|"/"J"/"NY") further left of
// the actual week number. Scans everything before the date (or before the opponent anchor, for
// a dateless BYE row) and prefers the LAST token that looks like a real week label — closest to
// the date, past any leading noise — over the raw leftmost one.
function extractWeekLabel(sorted: NormalizedWord[], anchorIndex: number): string {
  const upperBound = anchorIndex === -1 ? sorted.length : Math.max(anchorIndex, 1);
  const dowIndex = sorted.findIndex((w, i) => i < upperBound && DAY_OF_WEEK.test(w.text));
  const candidates = sorted.slice(0, dowIndex !== -1 ? dowIndex : upperBound);
  if (!candidates.length) return "";

  // "Conf Champ" is two words and won't look like a single number — check the whole
  // candidate span for it before falling back to a single-token numeric search.
  const joined = candidates.map((w) => w.text).join(" ");
  if (/conf(?:erence)?\.?\s*champ(?:ionship)?/i.test(joined)) return "Conf Champ";

  for (let i = candidates.length - 1; i >= 0; i--) {
    if (/^\d{1,2}$/.test(candidates[i].text)) return candidates[i].text;
  }
  // No clean digit found (OCR fully missed the numeral, e.g. read as "il" for "1") — fall back
  // to the leftmost token so there's still something for the caller/warnings to show, even
  // though it likely won't parse as a valid week number.
  return candidates[0].text;
}

// Opponent cell looks like "vs 6 Greedy Academy", "at Kansas", or "BYE". Anchors on the vs/at
// keyword (or a standalone "BYE") rather than a fixed column band, since the preceding
// week/date text and following time/record text vary in width. The exact-token match is tried
// first; if OCR glued "vs"/"at" to the next word with no space, a prefix match catches it too.
function parseOpponentCell(row: NormalizedWord[]): {
  isBye: boolean;
  opponentRaw: string | null;
  opponentRank: number | null;
  homeAway: "home" | "away" | null;
  weekLabel: string;
} {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const byeIndex = sorted.findIndex((w) => /^bye$/i.test(w.text));
  if (byeIndex !== -1) {
    return { isBye: true, opponentRaw: null, opponentRank: null, homeAway: null, weekLabel: extractWeekLabel(sorted, byeIndex) };
  }

  let anchorIndex = sorted.findIndex((w) => /^(vs\.?|at)$/i.test(w.text));
  let homeAway: "home" | "away" | null = null;
  let glued: string | null = null; // text remaining after stripping a glued-together anchor prefix
  if (anchorIndex !== -1) {
    homeAway = /^vs\.?$/i.test(sorted[anchorIndex].text) ? "home" : "away";
  } else {
    // OCR merged "vs"/"at" with the next word (no space) — e.g. "vsKansas" or "atUCF".
    anchorIndex = sorted.findIndex((w) => /^vs\.?[a-z0-9]/i.test(w.text) || /^at[a-z0-9]/i.test(w.text));
    if (anchorIndex !== -1) {
      const text = sorted[anchorIndex].text;
      const m = text.match(/^(vs\.?|at)(.+)$/i);
      if (m) {
        homeAway = /^vs\.?$/i.test(m[1]) ? "home" : "away";
        glued = m[2];
      }
    }
  }
  if (anchorIndex === -1 || !homeAway) {
    // Nothing recognizable — surface the raw row so it isn't silently dropped.
    return { isBye: false, opponentRaw: null, opponentRank: null, homeAway: null, weekLabel: extractWeekLabel(sorted, -1) };
  }

  // Everything right of the anchor, up to a word that looks like a clock time ("10:30", "PM"/
  // "AM", or OCR gluing them together as "9:15PM") or a W-L record ("0-0", sometimes read as
  // "00" with the dash dropped) — that's the next column starting. None of this catalog's team
  // names contain a digit, so once the name has started, any token with a digit (or a bare AM/
  // PM) reliably marks that boundary without needing to match every OCR time format exactly.
  const rest = sorted.slice(anchorIndex + 1);
  const nameWords: string[] = glued ? [glued] : [];
  let opponentRank: number | null = null;
  for (const w of rest) {
    if (nameWords.length > 0 && (/\d/.test(w.text) || /^[ap]\.?m\.?$/i.test(w.text))) break;
    // A lone 1-2 digit number (optionally "#"-prefixed) immediately after vs/at, before any
    // name text, is an AP rank, not part of the team name.
    if (nameWords.length === 0 && opponentRank === null && /^#?\d{1,2}$/.test(w.text)) {
      opponentRank = parseInt(w.text.replace("#", ""), 10);
      continue;
    }
    nameWords.push(w.text);
  }
  const opponentRaw = nameWords.join(" ").replace(/\s+/g, " ").trim() || null;
  return { isBye: false, opponentRaw, opponentRank, homeAway, weekLabel: extractWeekLabel(sorted, anchorIndex) };
}

function parseImageRows(words: NormalizedWord[]): ParsedTeamScheduleRow[] {
  const tableWords = words.filter((w) => w.y >= TABLE_Y_MIN && w.y <= TABLE_Y_MAX);
  const rows = groupIntoRows(tableWords, ROW_Y_TOLERANCE);
  const parsed: ParsedTeamScheduleRow[] = [];

  for (const row of rows) {
    const raw = rowText(row);
    if (!raw) continue; // Genuinely empty row (shouldn't happen after grouping, but be safe).

    const opponent = parseOpponentCell(row);
    const { weekNumber, label } = parseWeekLabel(opponent.weekLabel);

    parsed.push({
      weekNumber,
      weekLabel: label,
      isBye: opponent.isBye,
      opponentRaw: opponent.opponentRaw,
      opponentRank: opponent.opponentRank,
      homeAway: opponent.homeAway,
      awayScore: null,
      homeScore: null,
      rawRowText: raw,
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
  return [...byKey.values()];
}

// Some OCR misreads of a lone numeral don't survive as a clean digit at all (e.g. week "1"
// read as the two letters "il") — no regex fix is safe there without risking false positives
// on genuinely unrelated text. Since week rows are always listed in ascending, gap-free order
// (sequential regular-season weeks, one row per week including byes) top-to-bottom on screen,
// a row that has real game data (an opponent or BYE) but no parseable week number can be
// inferred as one past the last confirmed week above it. Walks in on-screen order (rowY), not
// the final weekNumber-sorted order. Inferred labels are marked so the review UI can flag them
// for a manual double-check rather than presenting them as equally certain.
function inferMissingWeekNumbers(rows: ParsedTeamScheduleRow[]): void {
  const byY = [...rows].sort((a, b) => a.rowY - b.rowY);
  let lastKnown: number | null = null;
  for (const row of byY) {
    if (row.weekNumber != null) {
      lastKnown = row.weekNumber;
      continue;
    }
    if (lastKnown != null && lastKnown < 20 && (row.isBye || row.opponentRaw)) {
      row.weekNumber = lastKnown + 1;
      row.weekLabel = row.weekLabel ? `${row.weekLabel} (inferred: ${row.weekNumber})` : `(inferred: ${row.weekNumber})`;
      lastKnown = row.weekNumber;
    }
  }
}

export async function parseTeamScheduleBuffers(buffers: Buffer[]): Promise<ParsedTeamSchedule> {
  const warnings: string[] = [];

  // rowY is normalized per-screenshot (0-1 within that image's own dimensions), so a row at
  // y=0.5 in a "top of scroll" screenshot and a row at y=0.5 in a "bottom of scroll" screenshot
  // are unrelated physical weeks that merely landed at the same fraction of their own image.
  // Merging variants and inferring missing week numbers must happen per-image, walking that
  // image's own top-to-bottom order — flattening every image's rows into one list first (as a
  // prior version of this function did) interleaves unrelated weeks by raw y and corrupts
  // inference for any row whose week number didn't OCR cleanly. Only combine across images
  // afterward, once every row carries a real (or per-image-inferred) week number to key on.
  const perImageRows: ParsedTeamScheduleRow[][] = [];
  for (const buffer of buffers) {
    const variantLists: ParsedTeamScheduleRow[][] = [];
    for (const variant of SCHEDULE_VARIANTS) {
      try {
        const words = await extractWordsForVariant(buffer, variant);
        variantLists.push(parseImageRows(words));
      } catch (err) {
        warnings.push(`OCR error (${variant}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const merged = mergeRowLists(variantLists);
    inferMissingWeekNumbers(merged);
    perImageRows.push(merged);
  }

  let rows = mergeRowLists(perImageRows);
  // Two screenshots often overlap by a row or two (a natural scroll-continuation capture), so
  // the same physical week can show up once per image, now both correctly week-numbered by the
  // per-image inference above but as separate row objects — collapse those here, keeping the
  // more complete row per week number.
  const byWeek = new Map<number, ParsedTeamScheduleRow>();
  const unresolved: ParsedTeamScheduleRow[] = [];
  for (const row of rows) {
    if (row.weekNumber == null) {
      unresolved.push(row);
      continue;
    }
    const existing = byWeek.get(row.weekNumber);
    if (!existing || completeness(row) > completeness(existing)) byWeek.set(row.weekNumber, row);
  }
  rows = [...byWeek.values(), ...unresolved];
  rows.sort((a, b) => (a.weekNumber ?? 999) - (b.weekNumber ?? 999) || a.rowY - b.rowY);
  if (!rows.length) warnings.push("No week rows could be read from the team schedule screenshot.");

  // Surface a sample of rows that produced no usable week number (still image-noise from the
  // header/footer, or a genuine parsing gap) — deduped by raw text, capped — so a bad parse is
  // diagnosable from the warnings alone instead of just vanishing.
  const unparsed = [...new Set(rows.filter((r) => r.weekNumber == null).map((r) => r.rawRowText))].slice(0, 15);
  if (unparsed.length) {
    warnings.push(`${unparsed.length} row(s) had no recognizable week number. Raw text: ${unparsed.map((t) => `"${t}"`).join(", ")}`);
  }

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
