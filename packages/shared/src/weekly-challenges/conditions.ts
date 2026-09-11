// Non-RTI weekly team challenges -- Phase 3 of the media/tweets/challenges rebuild (see
// C:\Users\josh_\.claude\plans\refactored-swimming-token.md). Mirrors
// packages/shared/src/immortality/challenges.ts's structured-condition/fails-closed design, but
// for TEAM-level (offense/defense/special-teams) box-score data instead of one RTI prospect's
// individual stat line -- there is no single "prospect" in an ordinary league, so the subject of
// every challenge is the member's own team for that week's game.
//
// The uploaded package's weekly_challenge_catalog.json (190 primary + 10 special-teams entries)
// is written as free-text requirement phrases ("30+ points", "Allow under 75 rushing yards",
// "Leading receiver 100+ yards"), not structured conditions. Of the catalog's 600 individual
// requirement phrases, 541 (90%) translate cleanly to data this codebase actually has -- team
// box-score totals (rec_team_game_stats), aggregated player stats for that team's game, and
// same-game per-player role checks (leading receiver/HB/TE/QB/defender, computed fresh each game,
// no history needed). The remaining ~10% need data this platform doesn't capture at all: rolling
// multi-game averages, opponent power-ranking/hot-streak context, prior-matchup history, a
// pre-game "designated player" mechanic, or stats never tracked (drops, yards-after-contact,
// safeties). Catalog entries needing any of those were EXCLUDED from the issuable pool rather
// than guessed at -- see config/weekly_challenge_catalog.json's provenance comment. 148 of the
// 200 entries (70 offense, 68 defense, all 10 special-teams) are fully gradable as a result.
import type { StatKey as PlayerStatKey } from "../immortality/challenges.js";

export type WeeklyChallengeSide = "offense" | "defense" | "special_teams";
export type WeeklyChallengeTier = "bronze" | "silver" | "gold";

/** Fields read directly off one rec_team_game_stats row (that team's own box score for the
 * game) -- covers points/yardage/red-zone/turnover-margin/result thresholds. */
export type TeamStatKey =
  | "points_for" | "points_against" | "off_yards_gained" | "off_rush_yards" | "off_pass_yards"
  | "off_first_down" | "turnovers_committed" | "red_zone_off_percentage" | "generated_turnovers"
  | "yards_allowed" | "rush_yards_allowed" | "pass_yards_allowed" | "first_downs_allowed"
  | "red_zone_def_percentage";

/** Fields summed across a team's rec_player_weekly_stats rows for that week (that team's whole
 * roster's box score, offense+defense+special-teams combined into one game's worth of totals) --
 * or, for agg_opponent, the same sum for the opposing team. total_tds/rush_20_plus/
 * completion_pct_team are computed once, same shape as immortality/challenges.ts's
 * derivedChallengeStats. */
export type AggStatKey =
  | "sacks" | "interceptions" | "forced_fumbles" | "fumble_recoveries" | "pass_deflections"
  | "broken_tackles" | "rush_tds" | "pass_tds" | "receiving_tds" | "defensive_tds" | "total_tds"
  | "interceptions_thrown" | "rushing_fumbles" | "rush_20_plus" | "receptions" | "receiving_yards"
  | "fg_made" | "fg_attempts" | "fg_50_made" | "xp_made" | "xp_attempts" | "punts_in_20"
  | "punt_long" | "touchbacks" | "completion_pct_team";

/** Per-player derived fields a role condition checks -- computed once per player row the same
 * way derivedChallengeStats does for RTI (scrimmage_yards = rush+receiving,
 * total_tds_player = every TD type that player scored). */
export type PlayerStat = PlayerStatKey | "scrimmage_yards" | "total_tds_player" | "sacks_and_tackles";

export type RolePosition = "QB" | "HB" | "RECEIVER" | "TE" | "DEFENDER" | "RUSHER" | "ANY" | "OFFENSE_ANY";
export type RoleMode = "max" | "any" | "count";
export type CompareOp = "gte" | "lte" | "lt";

export type WeeklyChallengeCondition =
  | { kind: "team"; stat: TeamStatKey; op: CompareOp; value: number }
  | { kind: "agg"; stat: AggStatKey; op: CompareOp; value: number }
  | { kind: "agg_opponent"; stat: AggStatKey; op: CompareOp; value: number }
  | { kind: "agg_eq"; statA: AggStatKey; statB: AggStatKey }
  | { kind: "team_margin_turnover"; op: CompareOp; value: number }
  | { kind: "result"; op: "win" }
  | { kind: "win_away" }
  | { kind: "margin"; op: CompareOp; value: number }
  | { kind: "role"; side: "self" | "opponent"; position: RolePosition; stat: PlayerStat; mode: RoleMode; op: CompareOp; value: number; minCount?: number }
  | { kind: "all"; parts: WeeklyChallengeCondition[] };

export type WeeklyChallengeEntry = {
  id: string;
  side: WeeklyChallengeSide;
  name: string;
  bronze: WeeklyChallengeCondition[];
  silverAdds: WeeklyChallengeCondition[];
  goldAdds: WeeklyChallengeCondition[];
};

/** Everything one team's one game contributes for grading -- built server-side from
 * rec_team_game_stats + aggregated/per-player rec_player_weekly_stats rows for both teams in
 * that game (see weekly-challenge-issuance.service.ts in apps/api). */
export type WeeklyChallengeGameContext = {
  team: Record<TeamStatKey, number> & { result: "win" | "loss" | "tie"; margin: number; isAway: boolean };
  self: Record<AggStatKey, number>;
  opponent: Record<AggStatKey, number>;
  selfPlayers: Array<Record<string, number | string>>;
  opponentPlayers: Array<Record<string, number | string>>;
};

function compare(op: CompareOp, actual: number, target: number): boolean {
  if (op === "gte") return actual >= target;
  if (op === "lte") return actual <= target;
  return actual < target;
}

function playerMatchesPosition(position: RolePosition, playerPosition: string): boolean {
  const p = playerPosition.toUpperCase();
  switch (position) {
    case "QB": return p === "QB";
    case "HB": return p === "HB" || p === "FB";
    case "TE": return p === "TE";
    case "RECEIVER": return p === "WR" || p === "TE";
    case "RUSHER": return p === "HB" || p === "FB" || p === "QB";
    // Madden/CFB position codes this roster actually stores (packages/shared/src/roster.ts's
    // MADDEN_POSITION_GROUPS) -- not the generic "DE/OLB/ILB" labels, which never match a real
    // rec_players.position value and would silently zero out every defender-role condition.
    case "DEFENDER": return ["LEDGE", "REDGE", "DT", "WILL", "MIKE", "SAM", "CB", "FS", "SS"].includes(p);
    case "OFFENSE_ANY": return ["QB", "HB", "FB", "WR", "TE"].includes(p);
    case "ANY": return true;
    default: return false;
  }
}

function playerStatValue(player: Record<string, number | string>, stat: PlayerStat): number | null {
  const value = player[stat];
  return typeof value === "number" ? value : null;
}

function evaluateRole(condition: Extract<WeeklyChallengeCondition, { kind: "role" }>, ctx: WeeklyChallengeGameContext): boolean {
  const pool = (condition.side === "self" ? ctx.selfPlayers : ctx.opponentPlayers)
    .filter((player) => playerMatchesPosition(condition.position, String(player.position ?? "")));
  if (condition.mode === "count") {
    const matching = pool.filter((player) => {
      const value = playerStatValue(player, condition.stat);
      return value != null && compare(condition.op, value, condition.value);
    });
    return matching.length >= (condition.minCount ?? 1);
  }
  if (condition.mode === "any") {
    return pool.some((player) => {
      const value = playerStatValue(player, condition.stat);
      return value != null && compare(condition.op, value, condition.value);
    });
  }
  // "max": the single best qualifying player -- e.g. "Leading receiver 100+ yards" is really
  // "does the team's top performer at this stat clear the bar", not "does everyone".
  const best = pool.reduce<number | null>((acc, player) => {
    const value = playerStatValue(player, condition.stat);
    if (value == null) return acc;
    return acc == null ? value : Math.max(acc, value);
  }, null);
  if (best == null) return condition.op === "lte" || condition.op === "lt" ? true : false;
  return compare(condition.op, best, condition.value);
}

/** Fails CLOSED, same principle as immortality/challenges.ts's evaluateChallengeCondition: a
 * condition this evaluator doesn't recognize, or missing data it needs, returns false rather
 * than silently passing. */
export function evaluateWeeklyChallengeCondition(condition: WeeklyChallengeCondition, ctx: WeeklyChallengeGameContext): boolean {
  switch (condition.kind) {
    case "team": {
      const value = ctx.team[condition.stat];
      return value != null && compare(condition.op, value, condition.value);
    }
    case "agg": {
      const value = ctx.self[condition.stat];
      return value != null && compare(condition.op, value, condition.value);
    }
    case "agg_opponent": {
      const value = ctx.opponent[condition.stat];
      return value != null && compare(condition.op, value, condition.value);
    }
    case "agg_eq": {
      const a = ctx.self[condition.statA];
      const b = ctx.self[condition.statB];
      return a != null && b != null && b > 0 && a === b;
    }
    case "team_margin_turnover": {
      const margin = (ctx.team.generated_turnovers ?? 0) - (ctx.team.turnovers_committed ?? 0);
      return compare(condition.op, margin, condition.value);
    }
    case "result": return ctx.team.result === "win";
    case "win_away": return ctx.team.result === "win" && ctx.team.isAway;
    case "margin": return ctx.team.result === "win" && compare(condition.op, ctx.team.margin, condition.value);
    case "role": return evaluateRole(condition, ctx);
    case "all": return condition.parts.every((part) => evaluateWeeklyChallengeCondition(part, ctx));
    default: return false;
  }
}

export type WeeklyChallengeTierResult = { tier: WeeklyChallengeTier; complete: boolean };

/** Tiers stack (see the catalog's "stacking_rule"): silver requires bronze's conditions PLUS its
 * own; gold requires all three groups. Grading each tier independently (not "highest tier only")
 * mirrors the RTI weekly board, which shows bronze/silver/gold as separate rows. */
export function evaluateWeeklyChallengeTiers(entry: WeeklyChallengeEntry, ctx: WeeklyChallengeGameContext): WeeklyChallengeTierResult[] {
  const bronzeOk = entry.bronze.every((c) => evaluateWeeklyChallengeCondition(c, ctx));
  const silverOk = bronzeOk && entry.silverAdds.every((c) => evaluateWeeklyChallengeCondition(c, ctx));
  const goldOk = silverOk && entry.goldAdds.every((c) => evaluateWeeklyChallengeCondition(c, ctx));
  return [
    { tier: "bronze", complete: bronzeOk },
    { tier: "silver", complete: silverOk },
    { tier: "gold", complete: goldOk },
  ];
}

export function pointsForWeeklyTeamTier(tier: WeeklyChallengeTier): number {
  return tier === "bronze" ? 1 : tier === "silver" ? 2 : 3;
}
