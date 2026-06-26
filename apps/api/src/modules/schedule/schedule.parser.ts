import Tesseract from "tesseract.js";
import {
  fetchImageBuffer,
  flattenPageWords,
  getWorker,
  groupIntoRows,
  preprocessImage,
  withOcrLock,
  type NormalizedWord,
  type PreprocessVariant,
} from "../box-score/box-score.parser.js";

// ─── Madden "League Schedule" list parser ──────────────────────────────────────
// Reads the schedule list screen (one row per game):
//   WEEK | GAME TIME | MATCHUP (Away @ Home, nicknames) | RESULT (AWAY a - h HOME)
//   | PLAYED (0/1) | FORCE WIN (None/Home/Away)
// The RESULT column carries the in-game abbreviations (display_abbr for relocated
// teams) and the final scores, so it's the reliable anchor. A row is treated as a
// game row only if its RESULT band yields a score line. One or two screenshots
// (scrolled top + bottom) are merged and de-duped by matchup.

export type ParsedScheduleGame = {
  awayAbbr: string | null;
  homeAbbr: string | null;
  awayScore: number | null;
  homeScore: number | null;
  awayNick: string | null;
  homeNick: string | null;
  played: boolean | null;
  forceWin: "none" | "home" | "away" | null;
  weekNumber: number | null;
  rawResult: string;
  rawMatchup: string;
  rowY: number;
};

export type ParsedScheduleWeek = {
  weekNumber: number | null;
  games: ParsedScheduleGame[];
  warnings: string[];
};

// Column x-bands as fractions of image width. Tuned to the 16:9 schedule screen;
// adjust against the verify fixtures if a column drifts.
const COL = {
  week: { min: 0.07, max: 0.23 },
  matchup: { min: 0.33, max: 0.52 },
  played: { min: 0.70, max: 0.77 },
  forceWin: { min: 0.76, max: 0.92 },
} as const;

// The RESULT column ("AWAY a - h HOME") is read by scanning this region and
// anchoring on the score pattern, so a drifting away-abbr isn't clipped by a
// hard band. Kept left of the PLAYED "0/1" column.
const RESULT_SCAN = { min: 0.50, max: 0.69 } as const;

// Rows of the table sit below the column header and above the on-screen footer.
const TABLE_Y_MIN = 0.37;
const TABLE_Y_MAX = 0.91;
const ROW_Y_TOLERANCE = 0.016;

// Multiple passes catch both the normal (light-on-dark) and selected/highlighted
// rows. Each variant is parsed independently and merged at the game level. The
// "highlight" pass specifically recovers the selected row the others wash out.
const SCHEDULE_VARIANTS: PreprocessVariant[] = ["stats", "robust", "default", "highlight"];

function extractWords(page: Tesseract.Page, width: number, height: number): NormalizedWord[] {
  return flattenPageWords(page)
    // Low cutoff on purpose — faint away-side digits (e.g. a selected row) are worth
    // keeping; garbage tokens don't resolve to a team and are dropped downstream.
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
  const worker = await getWorker();
  const { processed, width, height } = await preprocessImage(buffer, variant);
  const result = await withOcrLock(() => worker.recognize(processed, undefined, { blocks: true }));
  return extractWords(result.data, width, height);
}

function inBand(w: NormalizedWord, band: { min: number; max: number }): boolean {
  return w.x >= band.min && w.x <= band.max;
}

function bandText(row: NormalizedWord[], band: { min: number; max: number }): string {
  return row
    .filter((w) => inBand(w, band))
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text)
    .join(" ")
    .trim();
}

function normalizeDigits(text: string): string {
  return text.replace(/[OoQ]/g, "0").replace(/[lI|]/g, "1");
}

// RESULT looks like "MIN 31 - 35 LAC". Scan the result region of a row and anchor
// on the "score - score" pattern: the abbr immediately left of the away score is
// away, the abbr immediately right of the home score is home. Any field that can't
// be read becomes null so the review can flag it with "?". Returns null when the
// row has nothing result-like (header/footer/noise), so it isn't treated as a game.
function parseResultRegion(
  row: NormalizedWord[],
): { awayAbbr: string | null; awayScore: number | null; homeScore: number | null; homeAbbr: string | null; raw: string } | null {
  const raw = row
    .filter((w) => inBand(w, RESULT_SCAN))
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;

  const scored = raw.match(/([A-Za-z]{2,4})?\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*([A-Za-z]{2,4})?/);
  if (scored) {
    return {
      awayAbbr: scored[1]?.toUpperCase() ?? null,
      awayScore: parseInt(normalizeDigits(scored[2]), 10),
      homeScore: parseInt(normalizeDigits(scored[3]), 10),
      homeAbbr: scored[4]?.toUpperCase() ?? null,
      raw,
    };
  }

  // No score read but abbrs present (e.g. a highlighted row OCR'd poorly) — keep it
  // as a game with "?" scores so the commissioner can correct it.
  const abbrs = raw.match(/[A-Za-z]{2,4}/g) ?? [];
  const first = abbrs[0];
  if (first) {
    const last = abbrs[abbrs.length - 1];
    return {
      awayAbbr: first.toUpperCase(),
      awayScore: null,
      homeScore: null,
      homeAbbr: abbrs.length > 1 && last ? last.toUpperCase() : null,
      raw,
    };
  }
  return null;
}

function parseMatchup(raw: string): { awayNick: string | null; homeNick: string | null } {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/\s+(?:@|at|vs\.?|v)\s+/i);
  if (parts.length >= 2) {
    return { awayNick: parts[0].trim() || null, homeNick: parts.slice(1).join(" ").trim() || null };
  }
  return { awayNick: cleaned || null, homeNick: null };
}

function parsePlayed(raw: string): boolean | null {
  const v = normalizeDigits(raw).replace(/[^0-9]/g, "");
  if (v === "1") return true;
  if (v === "0") return false;
  return null;
}

function parseForceWin(raw: string): "none" | "home" | "away" | null {
  const v = raw.toLowerCase();
  if (v.includes("home")) return "home";
  if (v.includes("away")) return "away";
  if (v.includes("none")) return "none";
  return null;
}

function parseWeek(raw: string): number | null {
  const m = raw.match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 22 ? n : null;
}

function parseImageGames(words: NormalizedWord[]): { games: ParsedScheduleGame[]; weekHint: number | null } {
  const tableWords = words.filter((w) => w.y >= TABLE_Y_MIN && w.y <= TABLE_Y_MAX);
  const rows = groupIntoRows(tableWords, ROW_Y_TOLERANCE);
  const games: ParsedScheduleGame[] = [];
  const weekCounts = new Map<number, number>();

  for (const row of rows) {
    const result = parseResultRegion(row);
    // A real game row has at least one team abbreviation in the RESULT column.
    if (!result || (!result.awayAbbr && !result.homeAbbr)) continue;
    const resultRaw = result.raw;

    const matchupRaw = bandText(row, COL.matchup);
    const matchup = parseMatchup(matchupRaw);
    const weekNumber = parseWeek(bandText(row, COL.week));
    if (weekNumber) weekCounts.set(weekNumber, (weekCounts.get(weekNumber) ?? 0) + 1);

    games.push({
      awayAbbr: result.awayAbbr,
      homeAbbr: result.homeAbbr,
      awayScore: Number.isFinite(result.awayScore as number) ? result.awayScore : null,
      homeScore: Number.isFinite(result.homeScore as number) ? result.homeScore : null,
      awayNick: matchup.awayNick,
      homeNick: matchup.homeNick,
      played: parsePlayed(bandText(row, COL.played)),
      forceWin: parseForceWin(bandText(row, COL.forceWin)),
      weekNumber,
      rawResult: resultRaw,
      rawMatchup: matchupRaw,
      rowY: row.reduce((s, w) => s + w.y, 0) / row.length,
    });
  }

  let weekHint: number | null = null;
  let best = 0;
  for (const [week, count] of weekCounts) {
    if (count > best) {
      best = count;
      weekHint = week;
    }
  }
  return { games, weekHint };
}

// Identity for de-duping across the two scrolled screenshots.
function gameKey(g: ParsedScheduleGame): string {
  return `${g.awayAbbr ?? "?"}@${g.homeAbbr ?? "?"}`;
}

function completeness(g: ParsedScheduleGame): number {
  let n = 0;
  if (g.awayAbbr) n++;
  if (g.homeAbbr) n++;
  if (g.awayScore != null) n++;
  if (g.homeScore != null) n++;
  if (g.awayNick) n++;
  if (g.homeNick) n++;
  return n;
}

function mergeGameLists(lists: ParsedScheduleGame[][]): ParsedScheduleGame[] {
  const byKey = new Map<string, ParsedScheduleGame>();
  for (const list of lists) {
    for (const game of list) {
      const key = gameKey(game);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, game);
        continue;
      }
      // Keep the more complete read; fill any individual nulls from the other.
      const winner = completeness(game) > completeness(existing) ? game : existing;
      const other = winner === game ? existing : game;
      byKey.set(key, {
        ...winner,
        awayAbbr: winner.awayAbbr ?? other.awayAbbr,
        homeAbbr: winner.homeAbbr ?? other.homeAbbr,
        awayScore: winner.awayScore ?? other.awayScore,
        homeScore: winner.homeScore ?? other.homeScore,
        awayNick: winner.awayNick ?? other.awayNick,
        homeNick: winner.homeNick ?? other.homeNick,
        played: winner.played ?? other.played,
        forceWin: winner.forceWin ?? other.forceWin,
        weekNumber: winner.weekNumber ?? other.weekNumber,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.rowY - b.rowY);
}

export async function parseScheduleBuffers(buffers: Buffer[]): Promise<ParsedScheduleWeek> {
  const warnings: string[] = [];
  const lists: ParsedScheduleGame[][] = [];
  const weekHints: number[] = [];

  for (const buffer of buffers) {
    for (const variant of SCHEDULE_VARIANTS) {
      try {
        const words = await extractWordsForVariant(buffer, variant);
        const { games, weekHint } = parseImageGames(words);
        lists.push(games);
        if (weekHint) weekHints.push(weekHint);
      } catch (err) {
        warnings.push(`OCR error (${variant}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const games = mergeGameLists(lists);
  const weekNumber = weekHints.length
    ? weekHints.sort((a, b) => weekHints.filter((w) => w === b).length - weekHints.filter((w) => w === a).length)[0]
    : games.find((g) => g.weekNumber != null)?.weekNumber ?? null;

  if (!games.length) warnings.push("No game rows could be read from the schedule screenshot.");

  return { weekNumber, games, warnings };
}

export async function parseScheduleImages(imageUrls: string[]): Promise<ParsedScheduleWeek> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));
  return parseScheduleBuffers(buffers);
}

// ─── Debug helper (scripts/schedule-debug.ts) ──────────────────────────────────
export async function debugScheduleImage(buffer: Buffer, variant: PreprocessVariant = "stats") {
  const words = await extractWordsForVariant(buffer, variant);
  const tableWords = words.filter((w) => w.y >= TABLE_Y_MIN && w.y <= TABLE_Y_MAX);
  const rows = groupIntoRows(tableWords, ROW_Y_TOLERANCE);
  return rows.map((row) => ({
    y: Number((row.reduce((s, w) => s + w.y, 0) / row.length).toFixed(3)),
    words: [...row].sort((a, b) => a.x - b.x).map((w) => `${w.text}@${w.x.toFixed(2)}`),
  }));
}
