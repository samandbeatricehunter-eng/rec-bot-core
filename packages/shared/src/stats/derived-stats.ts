import { coerceSourceStatBag } from "./tagged-stat-keys.js";

/** NFL passer rating (0–158.3). EA imports this as passerRating; we label it QBR. */

function clampRatingComponent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2.375, value));
}

/** Truncate to 3 decimal places — NFL passer-rating components are truncated, not rounded. */
function trunc3(value: number): number {
  return Math.floor(value * 1000 + 1e-9) / 1000;
}

export function nflPasserRating(input: {
  attempts: number;
  completions: number;
  yards: number;
  touchdowns: number;
  interceptions: number;
}): number | null {
  const attempts = Number(input.attempts);
  if (!Number.isFinite(attempts) || attempts <= 0) return null;
  const completions = Number(input.completions) || 0;
  const yards = Number(input.yards) || 0;
  const touchdowns = Number(input.touchdowns) || 0;
  const interceptions = Number(input.interceptions) || 0;
  const a = trunc3(clampRatingComponent(((completions / attempts) - 0.3) * 5));
  const b = trunc3(clampRatingComponent(((yards / attempts) - 3) * 0.25));
  const c = trunc3(clampRatingComponent((touchdowns / attempts) * 20));
  const d = trunc3(clampRatingComponent(2.375 - ((interceptions / attempts) * 25)));
  return Math.round(((a + b + c + d) / 6) * 1000) / 10;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  if (!Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

function finiteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Fill derived rates (QBR, Cmp%, YPA, YPC, YPR) from the counting stats this player actually
 * has — imported EA weekly rows, box-score allocations, or manual submissions, depending on
 * the league's data mode.
 *
 * QBR is NFL passer rating. Import leagues store EA's passerRating on each week; season and
 * career totals cannot sum those weekly ratings, so we recompute from the imported
 * attempts/completions/yards/TDs/INTs (the same pieces EA used). Box-score and manual leagues
 * don't persist a rating field, so they use that same formula on the passing totals those
 * modes captured. If counting stats are missing but a source rating is present, we display it.
 */
export function attachDerivedPlayerStats(stats: Record<string, number>): Record<string, number> {
  const next = coerceSourceStatBag(stats);
  const attempts = Number(next.pass_attempts ?? 0);
  const completions = Number(next.pass_completions ?? 0);
  const passYards = Number(next.pass_yards ?? 0);
  const passTds = Number(next.pass_tds ?? 0);
  const intsThrown = Number(next.interceptions_thrown ?? 0);
  const computed = nflPasserRating({
    attempts, completions, yards: passYards, touchdowns: passTds, interceptions: intsThrown,
  });
  const imported = finiteNumber(next.passer_rating);
  const qbr = computed ?? imported;
  if (qbr != null) {
    next.qbr = qbr;
    // Replace a summed weekly passer_rating (meaningless across weeks) when we could recompute.
    if (computed != null) next.passer_rating = computed;
  }
  const cmpPct = ratio(completions, attempts);
  if (cmpPct != null) next.completion_pct = cmpPct * 100;
  const ypa = ratio(passYards, attempts);
  if (ypa != null) next.yards_per_attempt = ypa;

  const carries = Number(next.rush_attempts ?? 0);
  const rushYards = Number(next.rush_yards ?? 0);
  const ypc = ratio(rushYards, carries);
  if (ypc != null) next.yards_per_carry = ypc;

  const receptions = Number(next.receptions ?? 0);
  const recYards = Number(next.receiving_yards ?? 0);
  const ypr = ratio(recYards, receptions);
  if (ypr != null) next.yards_per_reception = ypr;

  return next;
}
