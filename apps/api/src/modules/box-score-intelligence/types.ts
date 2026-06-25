// Normalized inputs for the box-score intelligence engine (badges + stories).
//
// These types are the contract between the persistence layer (which reads
// rec_team_game_stats: offensive columns + the opponent's mirrored stats +
// offensive_stats/defensive_stats JSONB) and the pure rule functions in
// badge-rules.ts / story-angles.ts. Only tracked box-score stats appear here —
// no time of possession, individual players, TDs, attempts, or percentages we
// don't store. Keep it that way.

export type BadgeScope = "weekly" | "season" | "global";
export type BadgeTier = "normal" | "bronze" | "silver" | "gold" | "xf";

/** One team's view of one game. `opponent*` fields are the opponent's offense. */
export interface GameStats {
  // Identity
  leagueId: string;
  season: number;
  week: number;
  gameId: string | null;
  teamId: string | null;
  userId: string | null;
  opponentTeamId: string | null;

  // Outcome
  won: boolean;
  lost: boolean;
  tied: boolean;
  homeAway: "home" | "away";
  pointsFor: number;
  pointsAgainst: number;
  /** pointsFor - pointsAgainst (negative when losing). */
  margin: number;
  isPlayoff: boolean;
  isSuperBowl: boolean;

  // Team offense (tracked stats only)
  passingYards: number;
  rushingYards: number;
  /** Offense only: passingYards + rushingYards (= off_yards_gained). */
  offensiveYards: number;
  /** total_yards_gained — offense + return yards. */
  totalYards: number;
  firstDowns: number;
  thirdDownConversions: number;
  fourthDownConversions: number;
  twoPointConversions: number;
  turnoversCommitted: number;
  redZoneOffensivePct: number;
  kickReturnYards: number;
  puntReturnYards: number;

  // Opponent offense (mirror — for defensive badges)
  opponentFirstDowns: number;
  opponentThirdDownConversions: number;
  opponentTurnovers: number;
  opponentRedZoneOffensivePct: number;
}

/** Combined kick + punt return yards. */
export function returnYards(g: Pick<GameStats, "kickReturnYards" | "puntReturnYards">): number {
  return (g.kickReturnYards || 0) + (g.puntReturnYards || 0);
}

/** Season-to-date totals for one team/user (non-tiered season badges). */
export interface SeasonTotals {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  regularSeasonGames: number;
  regularSeasonLosses: number;
  passingYards: number;
  rushingYards: number;
  firstDowns: number;
  thirdDownConversions: number;
  fourthDownConversions: number;
  twoPointConversions: number;
  turnoversCommitted: number;
  /** Takeaways — opponents' committed turnovers, season total. */
  opponentTurnovers: number;
  returnYards: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Season red-zone offense %, aggregated. */
  seasonRedZoneOffPct: number;
  /** Opponents' season red-zone offense %, aggregated. */
  opponentSeasonRedZoneOffPct: number;
  wonDivision: boolean;
  wonChampionship: boolean;
}

/** Career-long counters for one user (permanent global badges). */
export interface CareerTotals {
  wins: number;
  gamesPlayed: number;
  seasonsCompleted: number;
  passingYards: number;
  rushingYards: number;
  firstDowns: number;
  thirdDownConversions: number;
  fourthDownConversions: number;
  gamesRedZone75: number;
  gamesOppRedZone40OrLess: number;
  turnoverFreeGames: number;
  winsWith3PlusTurnovers: number;
  winsOpp3PlusTurnovers: number;
  winsScoring38Plus: number;
  games200PlusRush: number;
  games375PlusPass: number;
  gamesBalanced: number;
  gamesNickelDime: number;
  bendDontBreakWins: number;
  homeWins: number;
  roadWins: number;
  playoffWins: number;
  superBowlTitles: number;
}
