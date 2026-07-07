import { STATS_Y_MIN, type NormalizedWord, type ParsedScore } from "./box-score.parser.types.js";
import { groupIntoRows } from "./box-score.parser.ocr.js";

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
  LEY: "LCV",
};

// Generic digit→letter OCR misread fixes — no real team abbreviation (Madden or the
// 136-team CFB catalog) legitimately contains a digit, so any digit surviving cleanup
// is a misread and safe to substitute, without needing to enumerate every real team's
// specific typo the way ABBR_OCR_TYPOS above does for known letter-for-letter misreads.
const DIGIT_OCR_TYPOS: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B" };

function correctTeamAbbr(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "???";
  if (ABBR_OCR_TYPOS[cleaned]) return ABBR_OCR_TYPOS[cleaned];
  if (/\d/.test(cleaned)) return cleaned.replace(/[0158]/g, (digit) => DIGIT_OCR_TYPOS[digit]);
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

  // Over-read quarter vs. a confidently-read total: e.g. Q2 13 misread as 18 pushes
  // the quarter sum to 39 while the total column correctly reads 34. When the total is
  // at least as confident as the weakest contributing quarter, trust the total and
  // shrink that quarter to close the gap instead of inflating the final score to the
  // bad sum. (The reverse — total misread low, quarters right — keeps the existing
  // "trust the sum" behavior below, because a low-confidence total fails this guard.)
  if (totalCell && sum > total && total > 0 && total <= 80) {
    const gap = sum - total;
    const weakest = quarterCells
      .map((cell, idx) => ({ cell, idx, q: qs[idx] }))
      .filter((c): c is { cell: { value: number; confidence: number }; idx: number; q: number } => !!c.cell && c.q > 0)
      .sort((a, b) => a.cell.confidence - b.cell.confidence)[0];
    if (weakest && totalCell.confidence >= weakest.cell.confidence && gap < weakest.q) {
      qs[weakest.idx] = weakest.q - gap;
      sum = qs.reduce((s, n) => s + n, 0);
    }
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

export function parseScoreHeader(words: NormalizedWord[]): { score: ParsedScore; statsTopY: number } | null {
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

// ─── Score quality / merge ───────────────────────────────────────────────────

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

export function pickBestScore(...candidates: (ParsedScore | null | undefined)[]): ParsedScore | null {
  return candidates
    .filter((s): s is ParsedScore => s != null)
    .map(reconcileScoreTotals)
    .sort((a, b) => scoreQuality(b) - scoreQuality(a))[0] ?? null;
}
