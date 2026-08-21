/**
 * Maps one EA / companion team-weekly payload onto rec_team_game_stats columns
 * and the box-score-shaped JSON blobs EOS, matchup ranks, SOS, and user rating read.
 *
 * Live Madden team-weekly keys (not the box-score names applyTeamStats used to look up):
 *   offPassYds / offRushYds / offTotalYds / off1stDowns
 *   defPassYds / defRushYds / defTotalYds
 *   tOGiveaways / tOTakeaways / defIntsRec
 *   offRedZonePct / defRedZonePct / offRedZoneTDs / offRedZoneFGs
 *   off3rdDownConv+Att / off4thDownConv+Att / off2PtConv+Att
 *
 * Season-to-date fields (offPtsPerGame, totalWins, seed, …) are dropped — they are
 * not per-game. Weekly points come from rec_games when the schedule row exists.
 */

export type EaTeamWeeklyGame = {
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

export type MappedTeamGameStats = {
  is_home: boolean;
  result: "win" | "loss" | "tie" | null;
  points_for: number | null;
  points_against: number | null;
  off_yards_gained: number | null;
  off_rush_yards: number | null;
  off_pass_yards: number | null;
  off_first_down: number | null;
  punt_return_yards: number | null;
  kick_return_yards: number | null;
  total_yards_gained: number | null;
  turnovers_committed: number | null;
  red_zone_off_percentage: number | null;
  time_of_possession: string | null;
  generated_turnovers: number | null;
  yards_allowed: number | null;
  rush_yards_allowed: number | null;
  pass_yards_allowed: number | null;
  first_downs_allowed: number | null;
  red_zone_def_percentage: number | null;
  offensive_stats: Record<string, unknown>;
  defensive_stats: Record<string, unknown>;
};

type Json = Record<string, unknown>;

function value(row: Json, keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return null;
}

function integer(row: Json, keys: string[]) {
  const found = value(row, keys);
  if (found === null || found === "") return null;
  const parsed = Number(found);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function number(row: Json, keys: string[]) {
  const found = value(row, keys);
  if (found === null || found === "") return null;
  const parsed = Number(found);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(row: Json, keys: string[]) {
  const found = value(row, keys);
  return found === null ? null : String(found).trim() || null;
}

/** EA red-zone % is 0–100; a 0–1 fraction is scaled. 0 is a real 0%, not missing. */
export function asPercentInt(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 0 && value <= 1) return Math.round(value * 100);
  return Math.round(value);
}

export function madeAttempts(made: number | null, att: number | null): string | null {
  if (made == null || att == null) return null;
  return `${made}-${att}`;
}

export function mapEaTeamWeeklyStats(input: {
  payload: Json;
  teamId: string;
  game: EaTeamWeeklyGame | null;
}): MappedTeamGameStats {
  const row = input.payload;
  const game = input.game;
  const knownHome = Boolean(game?.home_team_id);
  const isHome = knownHome ? game!.home_team_id === input.teamId : false;

  const gamePointsFor = game && game.home_score != null && game.away_score != null
    ? (isHome ? game.home_score : game.away_score)
    : null;
  const gamePointsAgainst = game && game.home_score != null && game.away_score != null
    ? (isHome ? game.away_score : game.home_score)
    : null;

  const pointsFor = gamePointsFor
    ?? integer(row, ["pointsFor", "points_for", "score", "teamScore", "team_score"]);
  const pointsAgainst = gamePointsAgainst
    ?? integer(row, ["pointsAgainst", "points_against", "opponentScore", "opponent_score"]);

  const offPass = integer(row, ["offPassYds", "passYds", "passingYards", "off_pass_yards"]);
  const offRush = integer(row, ["offRushYds", "rushYds", "rushingYards", "off_rush_yards"]);
  const offYards = integer(row, ["offTotalYds", "offYds", "offensiveYards", "off_yards_gained", "totalOffense"]);
  const totalYards = integer(row, ["offTotalYdsGained", "totalYds", "totalYards", "total_yards_gained"]) ?? offYards;
  const firstDowns = integer(row, ["off1stDowns", "firstDowns", "off_first_down"]);
  const giveaways = integer(row, ["tOGiveaways", "turnovers", "turnoversCommitted", "turnovers_committed"]);
  const takeaways = integer(row, ["tOTakeaways", "takeaways", "generatedTurnovers", "generated_turnovers"]);
  const defPass = integer(row, ["defPassYds", "passYardsAllowed", "pass_yards_allowed"]);
  const defRush = integer(row, ["defRushYds", "rushYardsAllowed", "rush_yards_allowed"]);
  const defYards = integer(row, ["defTotalYds", "yardsAllowed", "yards_allowed"]);
  const defFirst = integer(row, ["def1stDowns", "firstDownsAllowed", "first_downs_allowed"]);
  const rzOff = asPercentInt(number(row, ["offRedZonePct", "redZonePct", "redZoneOffPercentage", "red_zone_off_percentage"]));
  const rzDef = asPercentInt(number(row, ["defRedZonePct", "redZoneDefPct", "redZoneDefPercentage", "red_zone_def_percentage"]));
  const ints = integer(row, ["defIntsRec", "teamInterceptions", "team_interceptions"]);
  const thirdMade = integer(row, ["off3rdDownConv"]);
  const thirdAtt = integer(row, ["off3rdDownAtt"]);
  const fourthMade = integer(row, ["off4thDownConv"]);
  const fourthAtt = integer(row, ["off4thDownAtt"]);
  const twoPtMade = integer(row, ["off2PtConv"]);
  const twoPtAtt = integer(row, ["off2PtAtt"]);
  const third = madeAttempts(thirdMade, thirdAtt);
  const fourth = madeAttempts(fourthMade, fourthAtt);
  const twoPt = madeAttempts(twoPtMade, twoPtAtt);

  const offensive_stats: Record<string, unknown> = {
    off_yards_gained: offYards,
    off_rush_yards: offRush,
    off_pass_yards: offPass,
    off_first_down: firstDowns,
    turnovers: giveaways,
    third_down_conversions: third,
    off3rdDownConvPct: third,
    fourth_down_conversions: fourth,
    off4thDownConvPct: fourth,
    two_point_conversions: twoPt,
    red_zone_off_percentage: rzOff,
    red_zone_tds: integer(row, ["offRedZoneTDs", "red_zone_tds"]),
    red_zone_fgs: integer(row, ["offRedZoneFGs", "red_zone_fgs"]),
    penalties: integer(row, ["penalties"]),
    penalty_yards: integer(row, ["penaltyYds", "penalty_yards"]),
    off_rush_tds: integer(row, ["offRushTDs", "off_rush_tds"]),
    off_pass_tds: integer(row, ["offPassTDs", "off_pass_tds"]),
    off_sacks_taken: integer(row, ["offSacks"]),
    time_of_possession: text(row, ["timeOfPossession", "time_of_possession"]),
  };

  const defensive_stats: Record<string, unknown> = {
    yards_allowed: defYards,
    rush_yards_allowed: defRush,
    pass_yards_allowed: defPass,
    first_downs_allowed: defFirst,
    generated_turnovers: takeaways,
    takeaways,
    team_interceptions: ints,
    team_sacks: integer(row, ["defSacks", "teamSacks"]),
    fumble_recoveries: integer(row, ["defFumRec"]),
    forced_fumbles: integer(row, ["defForcedFum"]),
    red_zone_def_percentage: rzDef,
    red_zone_tds_allowed: integer(row, ["defRedZoneTDs"]),
    red_zone_fgs_allowed: integer(row, ["defRedZoneFGs"]),
  };

  Object.keys(offensive_stats).forEach((key) => {
    if (offensive_stats[key] == null) delete offensive_stats[key];
  });
  Object.keys(defensive_stats).forEach((key) => {
    if (defensive_stats[key] == null) delete defensive_stats[key];
  });

  const result = pointsFor == null || pointsAgainst == null
    ? null
    : pointsFor > pointsAgainst ? "win" : pointsFor < pointsAgainst ? "loss" : "tie";

  return {
    is_home: isHome,
    result,
    points_for: pointsFor,
    points_against: pointsAgainst,
    off_yards_gained: offYards,
    off_rush_yards: offRush,
    off_pass_yards: offPass,
    off_first_down: firstDowns,
    punt_return_yards: integer(row, ["puntReturnYds", "punt_return_yards"]),
    kick_return_yards: integer(row, ["kickReturnYds", "kick_return_yards"]),
    total_yards_gained: totalYards,
    turnovers_committed: giveaways,
    red_zone_off_percentage: rzOff,
    time_of_possession: text(row, ["timeOfPossession", "time_of_possession"]),
    generated_turnovers: takeaways,
    yards_allowed: defYards,
    rush_yards_allowed: defRush,
    pass_yards_allowed: defPass,
    first_downs_allowed: defFirst,
    red_zone_def_percentage: rzDef,
    offensive_stats,
    defensive_stats,
  };
}
