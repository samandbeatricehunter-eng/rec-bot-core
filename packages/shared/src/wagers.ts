// Wager market catalog + pure odds/payout math. No DB — the API's odds.service
// supplies the live inputs (win probabilities from power rankings, lines from
// season stat averages) and these helpers turn them into odds/payouts.

export type WagerMarketKind = "moneyline" | "spread" | "total";

export type WagerMarket = {
  key: string;
  label: string;
  kind: WagerMarketKind;
  /** Markets that need box-score stats are offered only on human-involved games. */
  requiresBoxScore: boolean;
  /** For totals: the logical stat the over/under line sits on. */
  statKey?: string;
  unit?: string;
};

export const WAGER_MARKETS: WagerMarket[] = [
  { key: "moneyline", label: "Moneyline (Winner)", kind: "moneyline", requiresBoxScore: false },
  { key: "spread", label: "Spread", kind: "spread", requiresBoxScore: false, unit: "pts" },
  { key: "total_points", label: "Total Points O/U", kind: "total", requiresBoxScore: false, statKey: "points", unit: "pts" },
  { key: "total_yards", label: "Total Yards O/U", kind: "total", requiresBoxScore: true, statKey: "total_yards", unit: "yds" },
  { key: "rushing_yards", label: "Rushing Yards O/U", kind: "total", requiresBoxScore: true, statKey: "rush_yards", unit: "yds" },
  { key: "passing_yards", label: "Passing Yards O/U", kind: "total", requiresBoxScore: true, statKey: "pass_yards", unit: "yds" },
  { key: "turnovers", label: "Total Turnovers O/U", kind: "total", requiresBoxScore: true, statKey: "turnovers" },
  { key: "redzone_off", label: "Red Zone Off % O/U", kind: "total", requiresBoxScore: true, statKey: "redzone_off", unit: "%" },
  { key: "redzone_def", label: "Red Zone Def % O/U", kind: "total", requiresBoxScore: true, statKey: "redzone_def", unit: "%" },
];

export const WAGER_MARKET_BY_KEY = new Map(WAGER_MARKETS.map((m) => [m.key, m]));

/** Markets available for a game given whether a human coach is involved (box score expected). */
export function marketsForGame(humanInvolved: boolean): WagerMarket[] {
  return humanInvolved ? WAGER_MARKETS : WAGER_MARKETS.filter((m) => m.kind === "moneyline");
}

// House margin (vig) baked into derived odds; standard -110-style price for
// spread/total markets.
const HOUSE_MARGIN = 0.05;
const SPREAD_TOTAL_ODDS = 1.91;
const MIN_ODDS = 1.05;
const MAX_ODDS = 15;

/** Fair decimal odds from a win probability, with the house margin applied. */
export function moneylineOddsFromProb(winProb: number): number {
  const p = Math.min(0.95, Math.max(0.05, winProb));
  const withMargin = (1 / p) * (1 - HOUSE_MARGIN);
  return clampOdds(Math.round(withMargin * 100) / 100);
}

export function spreadOrTotalOdds(): number {
  return SPREAD_TOTAL_ODDS;
}

function clampOdds(odds: number): number {
  return Math.min(MAX_ODDS, Math.max(MIN_ODDS, odds));
}

/** Boost multiplier applied to a parlay's combined odds (3-pick reward). */
export function parlayBoost(legCount: number): number {
  if (legCount >= 3) return 1.25;
  if (legCount === 2) return 1.1;
  return 1;
}

/** Combined decimal odds for a set of legs, with the parlay boost. */
export function parlayOdds(legOdds: number[]): number {
  const combined = legOdds.reduce((product, o) => product * (o || 1), 1);
  return clampOdds(Math.round(combined * parlayBoost(legOdds.length) * 100) / 100);
}

/** Total returned to the bettor on a win (stake included), floored to whole dollars. */
export function potentialPayout(stake: number, odds: number): number {
  return Math.max(stake, Math.floor(stake * odds));
}

export function americanFromDecimal(odds: number): string {
  if (odds <= 1) return "+0";
  if (odds >= 2) return `+${Math.round((odds - 1) * 100)}`;
  return `-${Math.round(100 / (odds - 1))}`;
}
