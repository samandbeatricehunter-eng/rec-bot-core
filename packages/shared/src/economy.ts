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
  { key: "qb_passing_yards", label: "QB Passing Yards", scope: "player", direction: "higher_is_better", statKey: "pass_yards", eligiblePositions: ["QB"], tiers: higher([["S", 6000, 200], ["A", 5500, 150], ["B", 5000, 100], ["C", 4000, 75], ["D", 3000, 50]]) },
  { key: "qb_passing_tds", label: "QB Passing TDs", scope: "player", direction: "higher_is_better", statKey: "pass_tds", eligiblePositions: ["QB"], tiers: higher([["S", 60, 200], ["A", 50, 150], ["B", 40, 100], ["C", 35, 75], ["D", 30, 50]]) },
  { key: "qb_rushing_yards", label: "QB Rushing Yards", scope: "player", direction: "higher_is_better", statKey: "rush_yards", eligiblePositions: ["QB"], tiers: higher([["S", 1000, 200], ["A", 750, 150], ["B", 500, 100], ["C", 350, 75], ["D", 200, 50]]) },
  { key: "qb_rushing_tds", label: "QB Rushing TDs", scope: "player", direction: "higher_is_better", statKey: "rush_tds", eligiblePositions: ["QB"], tiers: higher([["S", 25, 200], ["A", 20, 150], ["B", 15, 100], ["C", 10, 75], ["D", 5, 50]]) },
  { key: "qb_ball_security", label: "QB Ball Security Bonus", scope: "player", direction: "lower_is_better", statKey: "interceptions_thrown", eligiblePositions: ["QB"], minimums: { pass_attempts: 400 }, tiers: [{ tier: "S", threshold: 10, amount: 150, operator: "less_or_equal" }, { tier: "A", threshold: 15, amount: 100, operator: "less_or_equal" }, { tier: "B", threshold: 20, amount: 50, operator: "less_or_equal" }] },
  { key: "qb_completion_pct", label: "QB Completion Percentage Bonus", scope: "player", direction: "higher_is_better", statKey: "completion_pct", eligiblePositions: ["QB"], minimums: { pass_attempts: 300 }, tiers: higher([["S", 75, 200], ["A", 70, 150], ["B", 65, 100], ["C", 60, 50]]) },
  { key: "qb_sack_avoidance", label: "QB Sack Avoidance Bonus", scope: "player", direction: "lower_is_better", statKey: "sacks_taken", eligiblePositions: ["QB"], minimums: { pass_attempts: 400 }, tiers: lower([["S", 20, 150], ["A", 25, 100], ["B", 30, 50]]) },
  { key: "skill_rushing_yards", label: "HB/FB/WR/TE Rushing Yards", scope: "player", direction: "higher_is_better", statKey: "rush_yards", eligiblePositions: ["HB", "FB", "WR", "TE", "RB"], tiers: higher([["S", 2500, 200], ["A", 2000, 150], ["B", 1500, 100], ["C", 1250, 75], ["D", 1000, 50]]) },
  { key: "skill_rushing_tds", label: "HB/FB/WR/TE Rushing TDs", scope: "player", direction: "higher_is_better", statKey: "rush_tds", eligiblePositions: ["HB", "FB", "WR", "TE", "RB"], tiers: higher([["S", 25, 200], ["A", 20, 150], ["B", 17, 100], ["C", 14, 75], ["D", 10, 50]]) },
  { key: "receiving_yards", label: "WR/TE/HB Receiving Yards", scope: "player", direction: "higher_is_better", statKey: "receiving_yards", eligiblePositions: ["WR", "TE", "HB", "RB"], tiers: higher([["S", 1800, 200], ["A", 1200, 150], ["B", 1000, 100], ["C", 850, 75], ["D", 750, 50]]) },
  { key: "receiving_tds", label: "WR/TE/HB Receiving TDs", scope: "player", direction: "higher_is_better", statKey: "receiving_tds", eligiblePositions: ["WR", "TE", "HB", "RB"], tiers: higher([["S", 25, 200], ["A", 20, 150], ["B", 17, 100], ["C", 14, 75], ["D", 10, 50]]) },
  { key: "rb_workhorse", label: "RB Workhorse Bonus", scope: "player", direction: "higher_is_better", statKey: "rush_attempts", eligiblePositions: ["HB", "FB", "RB"], tiers: higher([["S", 350, 150], ["A", 300, 100], ["B", 250, 50]]) },
  { key: "receiver_volume", label: "Receiver Volume Bonus", scope: "player", direction: "higher_is_better", statKey: "receptions", eligiblePositions: ["WR", "TE", "HB", "RB"], tiers: higher([["S", 150, 150], ["A", 125, 100], ["B", 100, 50]]) },
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

export function evaluatePayoutTier(value: number, tiers: RecPayoutTierRule[]) {
  return tiers.find((rule) => {
    if (rule.operator === "greater_or_equal") return value >= rule.threshold;
    if (rule.operator === "less_than") return value < rule.threshold;
    if (rule.operator === "less_or_equal") return value <= rule.threshold;
    return false;
  }) ?? null;
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
