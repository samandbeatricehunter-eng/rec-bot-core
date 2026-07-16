// Bridges stored data to the pure engine: maps a rec_team_game_stats row (one
// team's view of one game) into the normalized GameStats input, and derives a
// compact tactical profile. The conversion counts (third/fourth-down, two-point)
// live in the offensive_stats/defensive_stats JSONB as "made-attempts" strings
// (e.g. "6-12"), so both halves are parsed here rather than read from dedicated
// columns — only the "made" half was read before 2026-07-16.

import { isCfb, isChampionshipWeek, regularSeasonWeeks, type LeagueGame } from "@rec/shared";
import { qualifyGameBadges, type QualifiedBadge } from "./badge-rules.js";
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
  yards_allowed: number | null;
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
const jsonRaw = (j: Record<string, string | number> | null, key: string): string | null => (j?.[key] != null ? String(j[key]) : null);

/** "made-attempts" -> [made, attempts]. Returns [made, null] if only the made half is present. */
function madeAttempts(j: Record<string, string | number> | null, key: string): [number, number | null] {
  const raw = jsonRaw(j, key);
  if (!raw) return [0, null];
  const m = raw.match(/^(-?\d+)-(-?\d+)$/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return [num(raw), null];
}

/** Clamps a value to [min, max]; returns null (and flags quarantine) when out of range. */
function sane(value: number | null, min: number, max: number, flags: { bad: boolean }): number | null {
  if (value == null) return null;
  if (value < min || value > max) {
    flags.bad = true;
    return null;
  }
  return value;
}

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

  const [thirdMade, thirdAttempts] = madeAttempts(row.offensive_stats, "third_down_conversions");
  const [fourthMade, fourthAttempts] = madeAttempts(row.offensive_stats, "fourth_down_conversions");
  const [oppThirdMade, oppThirdAttempts] = madeAttempts(row.defensive_stats, "third_down_conversions");
  const [oppFourthMade, oppFourthAttempts] = madeAttempts(row.defensive_stats, "fourth_down_conversions");

  const flags = { bad: false };
  const turnoversCommitted = sane(num(row.turnovers_committed), 0, 10, flags) ?? num(row.turnovers_committed);
  const opponentTurnovers = sane(num(row.generated_turnovers), 0, 10, flags) ?? num(row.generated_turnovers);
  if (thirdAttempts != null && thirdMade > thirdAttempts) flags.bad = true;
  if (fourthAttempts != null && fourthMade > fourthAttempts) flags.bad = true;

  const cfb = isCfb(game);
  const rushAttempts = cfb ? jsonNum(row.offensive_stats, "off_rush_attempts") || null : null;
  const passCompletions = cfb ? jsonNum(row.offensive_stats, "pass_completions") : null;
  const passAttempts = cfb ? jsonNum(row.offensive_stats, "pass_attempts") : null;
  if (cfb && passCompletions != null && passAttempts != null && passCompletions > passAttempts) flags.bad = true;
  const yardsPerPlay = cfb ? sane(jsonNum(row.offensive_stats, "yards_per_play") || null, 0, 25, flags) : null;
  const yardsPerRush = cfb ? sane(jsonNum(row.offensive_stats, "yards_per_rush") || null, 0, 25, flags) : null;
  const yardsPerPass = cfb ? sane(jsonNum(row.offensive_stats, "yards_per_pass") || null, 0, 25, flags) : null;
  const interceptionsThrown = cfb ? sane(jsonNum(row.offensive_stats, "interceptions_thrown") || null, 0, 10, flags) : null;
  const fumblesLost = cfb ? sane(jsonNum(row.offensive_stats, "fumbles_lost") || null, 0, 10, flags) : null;

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
    // "Championship" here means the season's final game — week 22 for NFL-style
    // games (madden_26/27), week 19 (national_championship) for CFB.
    isPlayoff: week > regularSeasonWeeks(game),
    isSuperBowl: isChampionshipWeek(week, game),
    isConferenceChampionshipGame: week === 15,
    isDivisionalRound: !cfb && week === 20,

    passingYards: pass,
    rushingYards: rush,
    offensiveYards,
    totalYards: row.total_yards_gained != null ? num(row.total_yards_gained) : offensiveYards,
    firstDowns: num(row.off_first_down),
    thirdDownConversions: thirdMade,
    fourthDownConversions: fourthMade,
    twoPointConversions: jsonNum(row.offensive_stats, "two_point_conversions"),
    turnoversCommitted,
    redZoneOffensivePct: num(row.red_zone_off_percentage),
    kickReturnYards: num(row.kick_return_yards),
    puntReturnYards: num(row.punt_return_yards),
    yardsAllowed: row.yards_allowed != null ? num(row.yards_allowed) : row.total_yards_gained != null ? num(row.total_yards_gained) : 0,

    opponentFirstDowns: row.first_downs_allowed != null ? num(row.first_downs_allowed) : jsonNum(row.defensive_stats, "off_first_down"),
    opponentThirdDownConversions: oppThirdMade,
    opponentThirdDownAttempts: oppThirdAttempts,
    opponentFourthDownConversions: oppFourthMade,
    opponentFourthDownAttempts: oppFourthAttempts,
    opponentTurnovers,
    opponentRedZoneOffensivePct: oppRzFromDef,

    totalPlays: cfb ? jsonNum(row.offensive_stats, "total_plays") || null : null,
    yardsPerPlay,
    rushAttempts,
    rushTDs: cfb ? jsonNum(row.offensive_stats, "off_rush_tds") || null : null,
    yardsPerRush,
    passCompletions,
    passAttempts,
    passTDs: cfb ? jsonNum(row.offensive_stats, "off_pass_tds") || null : null,
    yardsPerPass,
    thirdDownAttempts: cfb ? thirdAttempts : null,
    fourthDownAttempts: cfb ? fourthAttempts : null,
    interceptionsThrown,
    fumblesLost,
    redZoneTDs: cfb ? jsonNum(row.offensive_stats, "red_zone_tds") || null : null,
    redZoneFGs: cfb ? jsonNum(row.offensive_stats, "red_zone_fgs") || null : null,
    punts: cfb ? jsonNum(row.offensive_stats, "punts") || null : null,
    puntAvgYards: cfb ? jsonNum(row.offensive_stats, "punt_avg_yards") || null : null,
    penalties: cfb ? jsonNum(row.offensive_stats, "penalties") || null : null,
    penaltyYards: cfb ? jsonNum(row.offensive_stats, "penalty_yards") || null : null,
    timeOfPossessionSeconds: cfb ? jsonNum(row.offensive_stats, "time_of_possession") || null : null,

    statsQuarantined: flags.bad,
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
    qualifiedBadges: qualifyGameBadges(g, game),
  };
}
