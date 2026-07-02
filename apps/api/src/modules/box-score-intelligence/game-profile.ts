// Bridges stored data to the pure engine: maps a rec_team_game_stats row (one
// team's view of one game) into the normalized GameStats input, and derives a
// compact tactical profile. The conversion counts (third/fourth-down, two-point)
// live in the offensive_stats/defensive_stats JSONB as strings, so they're parsed
// here rather than read from dedicated columns.

import { isCfb, regularSeasonWeeks, type LeagueGame } from "@rec/shared";
import { qualifyWeeklyBadges, type QualifiedBadge } from "./badge-rules.js";
import { type GameStats, returnYards } from "./types.js";

/** Subset of rec_team_game_stats consumed by the intelligence engine. */
export interface TeamGameStatsRow {
  league_id: string;
  season_number: number;
  week_number: number;
  game_id: string | null;
  team_id: string | null;
  user_id: string | null;
  opponent_team_id: string | null;
  is_home: boolean | null;
  result: string | null; // 'win' | 'loss' | 'tie'
  points_for: number | null;
  points_against: number | null;
  off_pass_yards: number | null;
  off_rush_yards: number | null;
  off_yards_gained: number | null;
  total_yards_gained: number | null;
  off_first_down: number | null;
  turnovers_committed: number | null;
  red_zone_off_percentage: number | null;
  kick_return_yards: number | null;
  punt_return_yards: number | null;
  generated_turnovers: number | null;
  first_downs_allowed: number | null;
  red_zone_def_percentage: number | null;
  offensive_stats: Record<string, string | number> | null;
  defensive_stats: Record<string, string | number> | null;
}

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^0-9-]/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
};

const jsonNum = (j: Record<string, string | number> | null, key: string): number => num(j?.[key]);

export function rowToGameStats(row: TeamGameStatsRow, game: LeagueGame = null): GameStats {
  const pointsFor = num(row.points_for);
  const pointsAgainst = num(row.points_against);
  const pass = num(row.off_pass_yards);
  const rush = num(row.off_rush_yards);
  const offensiveYards = row.off_yards_gained != null ? num(row.off_yards_gained) : pass + rush;

  const result = row.result ?? (pointsFor > pointsAgainst ? "win" : pointsFor < pointsAgainst ? "loss" : "tie");
  const week = num(row.week_number);

  // red_zone_def_percentage is stored as 100 − opponent's red-zone offense, so the
  // opponent's red-zone offense is recoverable when defensive_stats lacks it.
  const oppRzFromDef = row.defensive_stats && row.defensive_stats["red_zone_off_percentage"] != null
    ? jsonNum(row.defensive_stats, "red_zone_off_percentage")
    : row.red_zone_def_percentage != null
      ? 100 - num(row.red_zone_def_percentage)
      : 0;

  return {
    leagueId: row.league_id,
    season: num(row.season_number),
    week,
    gameId: row.game_id,
    teamId: row.team_id,
    userId: row.user_id,
    opponentTeamId: row.opponent_team_id,

    won: result === "win",
    lost: result === "loss",
    tied: result === "tie",
    homeAway: row.is_home ? "home" : "away",
    pointsFor,
    pointsAgainst,
    margin: pointsFor - pointsAgainst,
    // "SuperBowl" here means the season's final championship game — week 22 for
    // NFL-style games (madden_26/27), week 17 (national_championship) for CFB.
    isPlayoff: week > regularSeasonWeeks(game),
    isSuperBowl: week >= (isCfb(game) ? 17 : 22),

    passingYards: pass,
    rushingYards: rush,
    offensiveYards,
    totalYards: row.total_yards_gained != null ? num(row.total_yards_gained) : offensiveYards,
    firstDowns: num(row.off_first_down),
    thirdDownConversions: jsonNum(row.offensive_stats, "third_down_conversions"),
    fourthDownConversions: jsonNum(row.offensive_stats, "fourth_down_conversions"),
    twoPointConversions: jsonNum(row.offensive_stats, "two_point_conversions"),
    turnoversCommitted: num(row.turnovers_committed),
    redZoneOffensivePct: num(row.red_zone_off_percentage),
    kickReturnYards: num(row.kick_return_yards),
    puntReturnYards: num(row.punt_return_yards),

    opponentFirstDowns: row.first_downs_allowed != null ? num(row.first_downs_allowed) : jsonNum(row.defensive_stats, "off_first_down"),
    opponentThirdDownConversions: jsonNum(row.defensive_stats, "third_down_conversions"),
    opponentTurnovers: num(row.generated_turnovers),
    opponentRedZoneOffensivePct: oppRzFromDef,
  };
}

export type OffensiveIdentity = "run_heavy" | "pass_heavy" | "balanced" | "mixed";

export interface GameProfile {
  offensiveIdentity: OffensiveIdentity;
  explosiveOffense: boolean; // 450+ offensive yards
  ballSecure: boolean; // 0 turnovers
  forcedTakeaways: boolean; // 3+ opponent turnovers
  stoutDefense: boolean; // <=14 points allowed
  redZoneSharp: boolean; // 75%+ red zone offense
  specialTeamsEdge: boolean; // 150+ return yards
  qualifiedBadges: QualifiedBadge[];
}

/** Compact tactical labels for rec_game_profiles.profile (tracked stats only). */
export function computeGameProfile(g: GameStats, game?: string | null): GameProfile {
  const offensiveIdentity: OffensiveIdentity =
    g.rushingYards - g.passingYards >= 75
      ? "run_heavy"
      : g.passingYards - g.rushingYards >= 200
        ? "pass_heavy"
        : g.passingYards >= 225 && g.rushingYards >= 125
          ? "balanced"
          : "mixed";

  return {
    offensiveIdentity,
    explosiveOffense: g.offensiveYards >= 450,
    ballSecure: g.turnoversCommitted === 0,
    forcedTakeaways: g.opponentTurnovers >= 3,
    stoutDefense: g.pointsAgainst <= 14,
    redZoneSharp: g.redZoneOffensivePct >= 75,
    specialTeamsEdge: returnYards(g) >= 150,
    qualifiedBadges: qualifyWeeklyBadges(g, game),
  };
}
