export type RecPayoutTier = "S" | "A" | "B" | "C" | "D";
export type RecTierOperator = "greater_or_equal" | "less_than" | "less_or_equal";

export type RecPayoutTierRule = {
  tier: RecPayoutTier;
  amount: number;
  threshold: number;
  operator: RecTierOperator;
};

export type RecEndSeasonPayoutDefinition = {
  key: string;
  label: string;
  scope: "player" | "team" | "ranking";
  direction: "higher_is_better" | "lower_is_better";
  statKey: string;
  eligiblePositions?: string[];
  minimums?: Record<string, number>;
  tiers: RecPayoutTierRule[];
};

const higher = (tiers: Array<[RecPayoutTier, number, number]>): RecPayoutTierRule[] =>
  tiers.map(([tier, threshold, amount]) => ({ tier, threshold, amount, operator: "greater_or_equal" }));

const lower = (tiers: Array<[RecPayoutTier, number, number]>): RecPayoutTierRule[] =>
  tiers.map(([tier, threshold, amount]) => ({ tier, threshold, amount, operator: "less_than" }));

export const REC_EOS_MINIMUM_ACTIVE_LINKED_USERS = 0;

export const REC_END_SEASON_PAYOUTS: RecEndSeasonPayoutDefinition[] = [
  {
    key: "power_ranking_position",
    label: "Power Ranking Position Bonus",
    scope: "ranking",
    direction: "lower_is_better",
    statKey: "power_rank",
    tiers: [
      { tier: "S", threshold: 1, amount: 1000, operator: "less_or_equal" },
      { tier: "A", threshold: 2, amount: 750, operator: "less_or_equal" },
      { tier: "B", threshold: 5, amount: 500, operator: "less_or_equal" },
      { tier: "C", threshold: 10, amount: 250, operator: "less_or_equal" },
      { tier: "D", threshold: 11, amount: 100, operator: "greater_or_equal" },
    ],
  },
  // Player-stat EOS payouts were removed: per-player stats are no longer stored
  // (box-score screenshot model is team-level only), so the league pays out solely
  // on team-scope categories and the power-ranking position bonus above.
  { key: "team_ppg", label: "TEAM AVG Points Per Game Bonus", scope: "team", direction: "higher_is_better", statKey: "points_per_game", tiers: higher([["S", 35, 200], ["A", 30, 150], ["B", 28, 100], ["C", 24, 75], ["D", 21, 50]]) },
  { key: "opp_ppg_allowed", label: "Opponent AVG PPG Defensive Bonus", scope: "team", direction: "lower_is_better", statKey: "points_allowed_per_game", tiers: lower([["S", 21, 200], ["A", 24, 150], ["B", 28, 100], ["C", 30, 75], ["D", 35, 50]]) },
  { key: "team_def_ints", label: "Total Team Defensive INTs", scope: "team", direction: "higher_is_better", statKey: "team_interceptions", tiers: higher([["S", 30, 200], ["A", 20, 150], ["B", 17, 100], ["C", 15, 75], ["D", 12, 50]]) },
  { key: "team_def_yards_allowed", label: "Total Team Defensive Yards Allowed", scope: "team", direction: "lower_is_better", statKey: "total_yards_allowed", tiers: lower([["S", 4000, 200], ["A", 4500, 150], ["B", 5000, 100], ["C", 5500, 75], ["D", 6000, 50]]) },
  { key: "team_sacks", label: "Team Defensive Sacks", scope: "team", direction: "higher_is_better", statKey: "team_sacks", tiers: higher([["S", 60, 200], ["A", 50, 150], ["B", 40, 100], ["C", 35, 75], ["D", 30, 50]]) },
  { key: "turnover_diff", label: "Turnover Differential", scope: "team", direction: "higher_is_better", statKey: "turnover_differential", tiers: higher([["S", 20, 200], ["A", 15, 150], ["B", 10, 100], ["C", 5, 75], ["D", 1, 50]]) },
  { key: "team_total_offense", label: "Team Total Offense", scope: "team", direction: "higher_is_better", statKey: "total_offense_yards", tiers: higher([["S", 7000, 200], ["A", 6500, 150], ["B", 6000, 100], ["C", 5500, 75], ["D", 5000, 50]]) },
  { key: "off_red_zone_td_rate", label: "Offensive Red-Zone TD Efficiency", scope: "team", direction: "higher_is_better", statKey: "red_zone_td_rate", tiers: higher([["S", 70, 200], ["A", 65, 150], ["B", 60, 100], ["C", 55, 75], ["D", 50, 50]]) },
  { key: "def_red_zone_td_rate", label: "Defensive Red-Zone TD Rate Allowed", scope: "team", direction: "lower_is_better", statKey: "red_zone_td_rate_allowed", tiers: lower([["S", 40, 200], ["A", 45, 150], ["B", 50, 100], ["C", 55, 75], ["D", 60, 50]]) }
];

function tierMatches(rule: RecPayoutTierRule, value: number): boolean {
  if (rule.operator === "greater_or_equal") return value >= rule.threshold;
  if (rule.operator === "less_than") return value < rule.threshold;
  if (rule.operator === "less_or_equal") return value <= rule.threshold;
  return false;
}

export function evaluatePayoutTier(value: number, tiers: RecPayoutTierRule[]) {
  return tiers.find((rule) => tierMatches(rule, value)) ?? null;
}

// The next higher-paying tier a value has NOT yet reached, given that `tiers` is
// ordered best-first (S → D). Returns null when the value already qualifies for
// the top tier (nothing better to chase). When the value qualifies for no tier
// yet, returns the easiest tier (last in the list) as the first target.
export function nextPayoutTier(value: number, tiers: RecPayoutTierRule[]): RecPayoutTierRule | null {
  const currentIdx = tiers.findIndex((rule) => tierMatches(rule, value));
  if (currentIdx === 0) return null; // already at the best tier
  if (currentIdx === -1) return tiers[tiers.length - 1] ?? null; // no tier yet → easiest target
  return tiers[currentIdx - 1] ?? null;
}

export const REC_WEEKLY_CHALLENGE_PAYOUTS = { S: 50, A: 25, B: 10 } as const;
export const REC_POTW_PAYOUT_AMOUNT = 10;

export function calculateOffensivePotwScore(input: {
  position?: string | null;
  passYds?: number;
  passTDs?: number;
  passInts?: number;
  rushYds?: number;
  rushTDs?: number;
  recYds?: number;
  recTDs?: number;
  receptions?: number;
}) {
  const position = String(input.position ?? "").toUpperCase();
  if (position === "QB") {
    return (input.passYds ?? 0) + (input.passTDs ?? 0) * 50 - (input.passInts ?? 0) * 40 + (input.rushYds ?? 0) + (input.rushTDs ?? 0) * 50;
  }
  return (input.rushYds ?? 0) + (input.recYds ?? 0) + ((input.rushTDs ?? 0) + (input.recTDs ?? 0)) * 50 + (input.receptions ?? 0) * 2;
}

export function calculateDefensivePotwScore(input: {
  sacks?: number;
  ints?: number;
  defensiveTDs?: number;
  forcedFumbles?: number;
  tackles?: number;
  tacklesForLoss?: number;
}) {
  return (input.sacks ?? 0) * 50 + (input.ints ?? 0) * 75 + (input.defensiveTDs ?? 0) * 100 + (input.forcedFumbles ?? 0) * 50 + (input.tackles ?? 0) * 3 + (input.tacklesForLoss ?? 0) * 10;
}


export const REC_GOTW_CORRECT_GUESS_PAYOUT = 10;

export function calculateGotwMatchupStrength(input: {
  awayWinPct?: number;
  homeWinPct?: number;
  awayPointDifferentialPerGame?: number;
  homePointDifferentialPerGame?: number;
  awayPowerRank?: number | null;
  homePowerRank?: number | null;
  isDivisionGame?: boolean;
  playoffImpact?: boolean;
  divisionLeadImpact?: boolean;
  previousGotwUserFlag?: boolean;
}) {
  const awayWinPct = input.awayWinPct ?? 0;
  const homeWinPct = input.homeWinPct ?? 0;
  const pdg = Math.min(20, Math.max(-20, (input.awayPointDifferentialPerGame ?? 0) + (input.homePointDifferentialPerGame ?? 0)));
  const powerScore = [input.awayPowerRank, input.homePowerRank].reduce<number>((sum, rank) => {
    if (!rank || rank <= 0) return sum;
    return sum + Math.max(0, 33 - rank) / 32 * 10;
  }, 0);
  const base = (awayWinPct + homeWinPct) * 40 + pdg + powerScore;
  const modifiers =
    (input.isDivisionGame ? 3 : 0) +
    (input.playoffImpact ? 8 : 0) +
    (input.divisionLeadImpact ? 5 : 0) -
    (input.previousGotwUserFlag ? 3 : 0);
  return Math.round((base + modifiers) * 10) / 10;
}
