// Builds the WeeklyChallengeGameContext (see @rec/shared's weekly-challenges/conditions.ts) one
// team's one week's data needs to grade every condition kind: the team's own rec_team_game_stats
// row (points/yards/red-zone/turnover-margin/result), aggregated rec_player_weekly_stats totals
// for that team's whole roster that week (sacks, INTs, TDs, kicking/punting...), the same for the
// opponent (for "allowed"/"opponent" conditions with no direct team_game_stats column), and
// per-player rows for same-game role checks (leading receiver, featured HB, etc.).
import { supabase } from "../../lib/supabase.js";
import type { AggStatKey, TeamStatKey, WeeklyChallengeGameContext } from "@rec/shared";

const TEAM_STAT_COLUMNS: Record<TeamStatKey, string> = {
  points_for: "points_for", points_against: "points_against", off_yards_gained: "off_yards_gained",
  off_rush_yards: "off_rush_yards", off_pass_yards: "off_pass_yards", off_first_down: "off_first_down",
  turnovers_committed: "turnovers_committed", red_zone_off_percentage: "red_zone_off_percentage",
  generated_turnovers: "generated_turnovers", yards_allowed: "yards_allowed",
  rush_yards_allowed: "rush_yards_allowed", pass_yards_allowed: "pass_yards_allowed",
  first_downs_allowed: "first_downs_allowed", red_zone_def_percentage: "red_zone_def_percentage",
};

function num(value: unknown): number { return Number(value) || 0; }

type RawPlayerStats = Record<string, unknown>;

function derivedPlayerFields(stats: RawPlayerStats): Record<string, number> {
  const rushYards = num(stats.rush_yards);
  const receivingYards = num(stats.receiving_yards);
  const rushTds = num(stats.rush_tds);
  const receivingTds = num(stats.receiving_tds);
  const passTds = num(stats.pass_tds);
  const defensiveTds = num(stats.defensive_tds);
  const sacks = num(stats.sacks);
  const tackles = num(stats.tackles);
  return {
    rush_yards: rushYards, receiving_yards: receivingYards, receptions: num(stats.receptions),
    pass_yards: num(stats.pass_yards), rush_tds: rushTds, receiving_tds: receivingTds, pass_tds: passTds,
    broken_tackles: num(stats.broken_tackles), rush_20_plus: num(stats.rush_20_plus),
    pass_deflections: num(stats.pass_deflections), interceptions: num(stats.interceptions),
    sacks, tackles, forced_fumbles: num(stats.forced_fumbles), fumble_recoveries: num(stats.fumble_recoveries),
    scrimmage_yards: rushYards + receivingYards,
    total_tds_player: rushTds + receivingTds + passTds + defensiveTds,
    sacks_and_tackles: sacks + tackles,
  };
}

async function loadTeamAndPlayers(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string) {
  const [statsRows, players] = await Promise.all([
    supabase.from("rec_player_weekly_stats").select("player_id,stats")
      .eq("league_id", leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber),
    supabase.from("rec_players").select("id,position,team_id").eq("team_id", teamId),
  ]);
  const teamPlayerIds = new Set((players.data ?? []).map((p) => String(p.id)));
  const positionByPlayer = new Map<string, string>((players.data ?? []).map((p) => [String(p.id), String(p.position ?? "")]));
  const rows = (statsRows.data ?? []).filter((row) => teamPlayerIds.has(String(row.player_id)));

  const agg: Record<AggStatKey, number> = {
    sacks: 0, interceptions: 0, forced_fumbles: 0, fumble_recoveries: 0, pass_deflections: 0,
    broken_tackles: 0, rush_tds: 0, pass_tds: 0, receiving_tds: 0, defensive_tds: 0, total_tds: 0,
    interceptions_thrown: 0, rushing_fumbles: 0, rush_20_plus: 0, receptions: 0, receiving_yards: 0,
    fg_made: 0, fg_attempts: 0, fg_50_made: 0, xp_made: 0, xp_attempts: 0, punts_in_20: 0,
    punt_long: 0, touchbacks: 0, completion_pct_team: 0,
  };
  let passCompletions = 0; let passAttempts = 0;
  const playerRows: Array<Record<string, number | string>> = [];

  for (const row of rows) {
    const stats = (row.stats ?? {}) as RawPlayerStats;
    const derived = derivedPlayerFields(stats);
    agg.sacks += derived.sacks; agg.interceptions += derived.interceptions;
    agg.forced_fumbles += derived.forced_fumbles; agg.fumble_recoveries += derived.fumble_recoveries;
    agg.pass_deflections += derived.pass_deflections; agg.broken_tackles += derived.broken_tackles;
    agg.rush_tds += derived.rush_tds; agg.pass_tds += derived.pass_tds; agg.receiving_tds += derived.receiving_tds;
    agg.defensive_tds += num(stats.defensive_tds);
    agg.total_tds += derived.total_tds_player;
    agg.interceptions_thrown += num(stats.interceptions_thrown);
    agg.rushing_fumbles += num(stats.rushing_fumbles);
    agg.rush_20_plus += derived.rush_20_plus;
    agg.receptions += derived.receptions; agg.receiving_yards += derived.receiving_yards;
    agg.fg_made += num(stats.fg_made); agg.fg_attempts += num(stats.fg_attempts);
    agg.fg_50_made += num(stats.fg_50_made); agg.xp_made += num(stats.xp_made); agg.xp_attempts += num(stats.xp_attempts);
    agg.punts_in_20 += num(stats.punts_in_20);
    agg.punt_long = Math.max(agg.punt_long, num(stats.punt_long));
    agg.touchbacks += num(stats.touchbacks);
    passCompletions += num(stats.pass_completions); passAttempts += num(stats.pass_attempts);

    playerRows.push({
      playerId: String(row.player_id),
      position: positionByPlayer.get(String(row.player_id)) ?? "",
      ...derived,
    });
  }
  agg.completion_pct_team = passAttempts > 0 ? (passCompletions / passAttempts) * 100 : 0;

  return { agg, playerRows };
}

/** Loads everything needed to grade one team's weekly challenges for one game. Returns null if
 * the team has no rec_team_game_stats row yet for that week (box score not in, or a bye) --
 * callers should skip issuance/grading entirely rather than grade against zeros, which would
 * silently fail every "N+" condition and pass every "0/allow-under" one. */
export async function buildWeeklyChallengeContext(input: {
  leagueId: string; seasonNumber: number; weekNumber: number; teamId: string;
}): Promise<WeeklyChallengeGameContext | null> {
  const teamRow = await supabase.from("rec_team_game_stats").select("*")
    .eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber)
    .eq("team_id", input.teamId).maybeSingle();
  if (!teamRow.data) return null;
  const row = teamRow.data as Record<string, unknown>;
  const opponentTeamId = row.opponent_team_id ? String(row.opponent_team_id) : null;

  const team = {} as WeeklyChallengeGameContext["team"];
  for (const key of Object.keys(TEAM_STAT_COLUMNS) as TeamStatKey[]) {
    (team as Record<string, number>)[key] = num(row[TEAM_STAT_COLUMNS[key]]);
  }
  team.result = (row.result as "win" | "loss" | "tie" | null) ?? (num(row.points_for) === num(row.points_against) ? "tie" : num(row.points_for) > num(row.points_against) ? "win" : "loss");
  team.margin = num(row.points_for) - num(row.points_against);
  team.isAway = row.is_home === false;

  const [self, opponent] = await Promise.all([
    loadTeamAndPlayers(input.leagueId, input.seasonNumber, input.weekNumber, input.teamId),
    opponentTeamId
      ? loadTeamAndPlayers(input.leagueId, input.seasonNumber, input.weekNumber, opponentTeamId)
      : Promise.resolve({ agg: {} as Record<AggStatKey, number>, playerRows: [] as Array<Record<string, number | string>> }),
  ]);

  return { team, self: self.agg, opponent: opponent.agg, selfPlayers: self.playerRows, opponentPlayers: opponent.playerRows };
}
