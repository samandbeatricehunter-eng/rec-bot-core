export type RecPayoutTier = "S" | "A" | "B" | "C" | "D";
export type RecTierOperator = "greater_or_equal" | "less_than" | "less_or_equal";

export type RecPayoutTierRule = {
  tier: RecPayoutTier;
  amount: number;
  threshold: number;
  operator: RecTierOperator;
};

export type RecLeagueDataMode = "import" | "box_scores" | "manual";

export type RecEndSeasonPayoutDefinition = {
  key: string;
  label: string;
  scope: "player" | "team" | "ranking";
  direction: "higher_is_better" | "lower_is_better";
  statKey: string;
  eligiblePositions?: string[];
  minimums?: Record<string, number>;
  tiers: RecPayoutTierRule[];
  /** Games this category applies to. Omit for shared/game-agnostic categories. */
  games?: string[];
  /**
   * Madden-only filter. CFB ignores this (its stats always come from box scores).
   * Madden `import` (EA auth / companion) uses EA canonical keys; `box_scores`
   * uses the stored box-score columns/JSON instead. Omit to apply in every mode.
   */
  dataModes?: RecLeagueDataMode[];
  /** Extra qualification note shown in the payout tooltip — e.g. a category with a special
   * one-time trigger/side-effect beyond just clearing the tier bar. */
  triggerNote?: string;
};

/** True if `definition` applies to `game` — no `games` list means shared across every game. */
export function isPayoutEligibleForGame(definition: RecEndSeasonPayoutDefinition, game: string | null | undefined): boolean {
  return !definition.games?.length || definition.games.includes(String(game ?? "madden_26"));
}

/**
 * Game + Madden data-mode gate. Import-only bonuses (player rushing extras, 50+ FGs,
 * team INTs from `defIntsRec`) stay hidden in Madden box-score leagues, which never
 * store those fields. CFB is unaffected.
 */
export function isPayoutEligibleForLeague(
  definition: RecEndSeasonPayoutDefinition,
  game: string | null | undefined,
  dataMode?: RecLeagueDataMode | null,
): boolean {
  if (!isPayoutEligibleForGame(definition, game)) return false;
  if (!definition.dataModes?.length) return true;
  if (!String(game ?? "").startsWith("madden_")) return true;
  const mode: RecLeagueDataMode = dataMode === "import" || dataMode === "manual" ? dataMode : "box_scores";
  return definition.dataModes.includes(mode);
}

const higher = (tiers: Array<[RecPayoutTier, number, number]>): RecPayoutTierRule[] =>
  tiers.map(([tier, threshold, amount]) => ({ tier, threshold, amount, operator: "greater_or_equal" }));

const lower = (tiers: Array<[RecPayoutTier, number, number]>): RecPayoutTierRule[] =>
  tiers.map(([tier, threshold, amount]) => ({ tier, threshold, amount, operator: "less_than" }));

/** Hard floor: coin economy payouts stay blocked until this many users are linked to teams. */
export const REC_ECONOMY_MINIMUM_LINKED_USERS = 8;
/** @deprecated Prefer REC_ECONOMY_MINIMUM_LINKED_USERS — kept for older EOS call sites. */
export const REC_EOS_MINIMUM_ACTIVE_LINKED_USERS = REC_ECONOMY_MINIMUM_LINKED_USERS;

const MADDEN_GAMES = ["madden_26", "madden_27"];

export const REC_END_SEASON_PAYOUTS: RecEndSeasonPayoutDefinition[] = [
  {
    key: "power_ranking_position",
    label: "Power Ranking Position Bonus",
    scope: "ranking",
    direction: "lower_is_better",
    statKey: "power_rank",
    // The REAL dollar amount always comes from the `rec_eos_rank_payouts` SQL function
    // (supabase/migrations/202606130006_rec_eos_rank_payouts_rpc.sql) — it pays a distinct
    // amount per exact rank (2500/1750/1250/1000/750/750/500/500, 0 for rank 9+), which is finer-
    // grained than this 5-tier ladder can represent exactly. These tiers exist only for
    // display (qualified_tier label, EOS progress bars) and for the commissioner's manual
    // "adjust to a different tier" override — so each tier is anchored to the WORST-case
    // (lowest) amount actually paid within its rank band, never the best case, so an
    // adjustment can never pay out more than that rank could really earn. If the RPC's
    // amount table changes, update this to match.
    tiers: [
      { tier: "S", threshold: 1, amount: 2500, operator: "less_or_equal" },
      { tier: "A", threshold: 2, amount: 1750, operator: "less_or_equal" },
      { tier: "B", threshold: 5, amount: 750, operator: "less_or_equal" },
      { tier: "C", threshold: 8, amount: 500, operator: "less_or_equal" },
      { tier: "D", threshold: 9, amount: 0, operator: "greater_or_equal" },
    ],
  },
  // Player-stat EOS payouts were removed: per-player stats are no longer stored
  // (box-score screenshot model is team-level only), so the league pays out solely
  // on team-scope categories and the power-ranking position bonus above.
  //
  // team_sacks was removed 2026-07-16: neither the Madden nor the CFB box-score parser
  // ever produces a "sacks" stat, so this category always resolved to the bottom tier.
  //
  // team_def_ints: CFB always uses opponent interceptions_thrown from the box score.
  // Madden only has a real INT count in EA/companion imports (defIntsRec); box-score
  // Madden leagues stay on turnover_diff instead.
  // All team-scope stat categories are evaluated per game (converted 2026-08-03) so teams
  // stay comparable while box scores are uploaded at uneven rates — a season total would
  // reward whoever happened to have the most games logged. Rate categories (red-zone %,
  // ToP, finish rate) were already game-agnostic.
  // Recalibrated 2026-08-05 — 44 PPG for S tier was unreachable outside inflated sim scoring
  // (a real 40+ PPG season, which the old ladder only paid Tier A, is already elite). Shifted
  // the whole ladder down ~10% while keeping the same relative spacing.
  { key: "team_ppg", label: "TEAM AVG Points Per Game Bonus", scope: "team", direction: "higher_is_better", statKey: "points_per_game", tiers: higher([["S", 40, 200], ["A", 36, 150], ["B", 32, 100], ["C", 28, 75], ["D", 25, 50]]) },
  { key: "opp_ppg_allowed", label: "Opponent AVG PPG Defensive Bonus", scope: "team", direction: "lower_is_better", statKey: "points_allowed_per_game", tiers: lower([["S", 16, 200], ["A", 19, 150], ["B", 22, 100], ["C", 25, 75], ["D", 28, 50]]) },
  { key: "team_def_ints", label: "Team Defensive INTs (per game)", scope: "team", direction: "higher_is_better", statKey: "team_interceptions", games: ["cfb_27", ...MADDEN_GAMES], dataModes: ["import"], tiers: higher([["S", 2.5, 200], ["A", 2.0, 150], ["B", 1.6, 100], ["C", 1.3, 75], ["D", 1.2, 50]]) },
  { key: "team_def_yards_allowed", label: "Defensive Yards Allowed (per game)", scope: "team", direction: "lower_is_better", statKey: "total_yards_allowed", tiers: lower([["S", 300, 200], ["A", 340, 150], ["B", 380, 100], ["C", 430, 75], ["D", 500, 50]]) },
  { key: "turnover_diff", label: "Turnover Differential (per game)", scope: "team", direction: "higher_is_better", statKey: "turnover_differential", tiers: higher([["S", 1.4, 200], ["A", 1.0, 150], ["B", 0.7, 100], ["C", 0.4, 75], ["D", 0.15, 50]]) },
  // Recalibrated 2026-08-05 alongside team_ppg — same inflation pattern, same ~-20yd shift.
  { key: "team_total_offense", label: "Team Total Offense (per game)", scope: "team", direction: "higher_is_better", statKey: "total_offense_yards", tiers: higher([["S", 460, 200], ["A", 430, 150], ["B", 410, 100], ["C", 390, 75], ["D", 370, 50]]) },
  { key: "off_red_zone_td_rate", label: "Offensive Red-Zone TD Efficiency", scope: "team", direction: "higher_is_better", statKey: "red_zone_td_rate", tiers: higher([["S", 80, 200], ["A", 75, 150], ["B", 70, 100], ["C", 65, 75], ["D", 60, 50]]) },
  { key: "def_red_zone_td_rate", label: "Defensive Red-Zone TD Rate Allowed", scope: "team", direction: "lower_is_better", statKey: "red_zone_td_rate_allowed", tiers: lower([["S", 35, 200], ["A", 40, 150], ["B", 45, 100], ["C", 50, 75], ["D", 55, 50]]) },

  // CFB-only additions (2026-07-16), leveraging stat fields CFB's box score
  // captures but Madden's doesn't (rush attempts/TDs, penalties, red-zone
  // TD-vs-FG split, time of possession).
  { key: "time_of_possession", label: "Time of Possession Bonus", scope: "team", direction: "higher_is_better", statKey: "avg_time_of_possession_seconds", games: ["cfb_27"], tiers: higher([["S", 18.5 * 60, 200], ["A", 18 * 60, 150], ["B", 17.5 * 60, 100], ["C", 17 * 60, 75], ["D", 16.5 * 60, 50]]) },
  { key: "well_disciplined", label: "Well-Disciplined (Penalties per Game)", scope: "team", direction: "lower_is_better", statKey: "total_penalties", games: ["cfb_27", ...MADDEN_GAMES], dataModes: ["import"], tiers: lower([["S", 1.2, 200], ["A", 2, 150], ["B", 3, 100], ["C", 4, 75], ["D", 5, 50]]) },
  { key: "red_zone_finish_rate", label: "Red Zone Finish Rate", scope: "team", direction: "higher_is_better", statKey: "red_zone_td_finish_rate", games: ["cfb_27", ...MADDEN_GAMES], dataModes: ["import"], tiers: higher([["S", 90, 200], ["A", 72, 150], ["B", 65, 100], ["C", 58, 75], ["D", 50, 50]]) },
  // Recalibrated 2026-08-05 from a single all-or-nothing S tier (threshold 85) to a full
  // ladder with partial credit — 85 required near-max carries AND near-max yards/carry
  // simultaneously, which real bell-cow backs (high volume, merely good efficiency — heavy
  // usage against stacked boxes usually caps ypc) rarely hit together. Formula unchanged
  // (evalTeamStat in eos-payouts.service.ts): (attempts/games)*2 + avgYardsPerRush*3 + (rushTDs/games)*8.
  { key: "rb_workhorse", label: "RB Workhorse Bonus", scope: "team", direction: "higher_is_better", statKey: "rb_workhorse_score", games: ["cfb_27"], tiers: higher([["S", 75, 200], ["A", 65, 150], ["B", 55, 100], ["C", 45, 75], ["D", 35, 50]]) },
  // Recalibrated 2026-08-05: was a single S-tier-only composite (red-zone D 25% + takeaways
  // 25% + 3rd-down stops 25% + 4th-down stops 25%, threshold 80) with no yards/points-allowed
  // signal at all despite those being core defensive-dominance stats, and no partial credit.
  // Now a full ladder; formula reworked in evalTeamStat (eos-payouts.service.ts) to 5 terms of
  // 20 pts each — red-zone D, takeaways (weight increased so 3+ takeaways/game alone can supply
  // most of a tier), yards allowed, points allowed, 3rd-down stops. Dropped 4th-down stops (too
  // low-sample per game to reliably carry 20-25% of the score). Only the S tier still unlocks
  // naming the defense — A-D pay out without that privilege.
  {
    key: "defense_needs_a_name",
    label: "This Defense Needs a Name",
    scope: "team",
    direction: "higher_is_better",
    statKey: "defense_identity_score",
    games: ["cfb_27"],
    tiers: [
      { tier: "S", threshold: 80, amount: 200, operator: "greater_or_equal" },
      { tier: "A", threshold: 68, amount: 150, operator: "greater_or_equal" },
      { tier: "B", threshold: 56, amount: 100, operator: "greater_or_equal" },
      { tier: "C", threshold: 44, amount: 75, operator: "greater_or_equal" },
      { tier: "D", threshold: 32, amount: 50, operator: "greater_or_equal" },
    ],
    triggerNote: "Clearing the S tier lets you name your defense — it keeps that name until it stops qualifying.",
  },

  // Madden import-only player bonuses. Box-score leagues never store broken tackles,
  // yards after contact, or 50+ FG splits, so these stay gated to EA/companion imports.
  {
    key: "madden_rb_workhorse",
    label: "RB Workhorse Bonus",
    scope: "player",
    direction: "higher_is_better",
    statKey: "madden_rb_workhorse_qualified",
    games: MADDEN_GAMES,
    dataModes: ["import"],
    eligiblePositions: ["HB", "FB", "RB"],
    minimums: {
      rush_attempts: 150,
      rush_yards: 1000,
      broken_tackles: 50,
      rush_yards_after_contact: 250,
      rush_tds: 10,
    },
    tiers: higher([["S", 1, 1000]]),
    triggerNote: "Pays 1,000 coins per user-team rusher with 150+ carries, 1,000+ rush yards, 50+ broken tackles, 250+ yards after contact, and 10+ rush TDs.",
  },
  {
    key: "king_of_the_swing",
    label: "King of the Swing",
    scope: "player",
    direction: "higher_is_better",
    statKey: "king_of_the_swing_qualified",
    games: MADDEN_GAMES,
    dataModes: ["import"],
    eligiblePositions: ["K"],
    minimums: { fg_50_attempts: 2 },
    tiers: higher([["S", 1, 500]]),
    triggerNote: "Pays 500 coins per user-team kicker with at least two 50+ yard field-goal attempts, all made.",
  },
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

export type RecTierProgress = {
  currentTier: RecPayoutTier | null;
  currentAmount: number;
  nextTier: RecPayoutTierRule | null;
  /** 0-100. 100 only once the top (S) tier is reached; capped at 99 while still chasing `nextTier`. */
  percent: number;
};

// Progress toward the next-better tier, anchored between a "floor" and `nextTier.threshold`.
// The floor is the currently-qualified tier's own threshold when one is reached, or — when no
// tier has been reached yet — the worst (D) tier's threshold pushed out by that same D/C gap, so
// the bar still has a sensible starting reference derived from the definition's own spacing
// rather than an arbitrary constant unrelated to the stat's scale.
export function computeTierProgress(value: number, tiers: RecPayoutTierRule[], direction: "higher_is_better" | "lower_is_better"): RecTierProgress {
  const currentRule = evaluatePayoutTier(value, tiers);
  const next = nextPayoutTier(value, tiers);
  if (!next) return { currentTier: currentRule?.tier ?? null, currentAmount: currentRule?.amount ?? 0, nextTier: null, percent: 100 };

  const worst = tiers[tiers.length - 1];
  const secondWorst = tiers[tiers.length - 2];
  const gap = secondWorst ? Math.abs(secondWorst.threshold - worst.threshold) : Math.abs(worst.threshold) * 0.25 || 1;
  const floor = currentRule
    ? currentRule.threshold
    : direction === "higher_is_better" ? worst.threshold - gap : worst.threshold + gap;

  const span = direction === "higher_is_better" ? next.threshold - floor : floor - next.threshold;
  const progressed = direction === "higher_is_better" ? value - floor : floor - value;
  const percent = span > 0 ? Math.max(0, Math.min(99, (progressed / span) * 100)) : 0;

  return { currentTier: currentRule?.tier ?? null, currentAmount: currentRule?.amount ?? 0, nextTier: next, percent };
}

export const REC_WEEKLY_CHALLENGE_PAYOUTS = { S: 50, A: 25, B: 10 } as const;
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

/** League wallet currency display — coins (not Stripe USD). */
export const COIN_EMOJI = "🪙";
export const COIN_NAME = "coins";
export const COIN_NAME_SINGULAR = "coin";

function coerceCoinAmount(amount: number | null | undefined): number {
  const n = Number(amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Grouped number only (for UI next to a coin icon). */
export function coinsNumber(
  amount: number | null | undefined,
  options?: { signed?: boolean },
): string {
  const n = coerceCoinAmount(amount);
  const abs = Math.abs(n).toLocaleString("en-US");
  if (options?.signed) {
    if (n > 0) return `+${abs}`;
    if (n < 0) return `-${abs}`;
    return abs;
  }
  return n < 0 ? `-${abs}` : abs;
}

/** Discord / plain text — e.g. "🪙 1,250" */
export function formatCoins(
  amount: number | null | undefined,
  options?: { signed?: boolean },
): string {
  return `${COIN_EMOJI} ${coinsNumber(amount, options)}`;
}

/** Store price ranges — e.g. "🪙 500–2,000" */
export function formatCoinsRange(min: number, max: number): string {
  return `${COIN_EMOJI} ${coinsNumber(min)}–${coinsNumber(max)}`;
}

/** Spoken form — "1,250 coins" */
export function formatCoinsWords(amount: number | null | undefined): string {
  const n = Math.abs(coerceCoinAmount(amount));
  const label = n === 1 ? COIN_NAME_SINGULAR : COIN_NAME;
  const sign = coerceCoinAmount(amount) < 0 ? "-" : "";
  return `${sign}${n.toLocaleString("en-US")} ${label}`;
}
