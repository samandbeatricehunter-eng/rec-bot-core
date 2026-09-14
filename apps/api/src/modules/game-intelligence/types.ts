// Normalized inputs for the box-score intelligence engine (game profile + story).
//
// These types are the contract between the persistence layer (which reads
// rec_team_game_stats: offensive columns + the opponent's mirrored stats +
// offensive_stats/defensive_stats JSONB) and the pure rule functions in
// story-angles.ts / game-profile.ts.
//
// CFB-only fields are optional and null for Madden games.

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
  isConferenceChampionshipGame: boolean;
  /** Madden only — the divisional playoff round. */
  isDivisionalRound: boolean;

  /** Total yards this team's defense allowed (opponent's total_yards_gained). */
  yardsAllowed: number;
  /** True if any raw stat for this game failed sanity validation (see game-profile.ts). */
  statsQuarantined: boolean;

  // Team offense (tracked stats — shared by both games)
  passingYards: number;
  rushingYards: number;
  /** Offense only: passingYards + rushingYards (= off_yards_gained). */
  offensiveYards: number;
  /** total_yards_gained — offense + return yards. */
  totalYards: number;
  firstDowns: number;
  /** Made count only (see thirdDownAttempts for the CFB-only attempts half). */
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
  opponentThirdDownAttempts: number | null;
  opponentFourthDownConversions: number;
  opponentFourthDownAttempts: number | null;
  opponentTurnovers: number;
  opponentInterceptionsThrown: number | null;
  opponentFumblesLost: number | null;
  opponentRedZoneOffensivePct: number;

  // ── CFB-only (null for madden_26/madden_27) ──────────────────────────────
  totalPlays: number | null;
  yardsPerPlay: number | null;
  rushAttempts: number | null;
  rushTDs: number | null;
  yardsPerRush: number | null;
  passCompletions: number | null;
  passAttempts: number | null;
  passTDs: number | null;
  yardsPerPass: number | null;
  /** The "attempts" half of the third/fourth-down made-attempts pair, when recoverable. */
  thirdDownAttempts: number | null;
  fourthDownAttempts: number | null;
  interceptionsThrown: number | null;
  fumblesLost: number | null;
  redZoneTDs: number | null;
  redZoneFGs: number | null;
  punts: number | null;
  puntAvgYards: number | null;
  penalties: number | null;
  penaltyYards: number | null;
  /** Seconds of possession this team held. */
  timeOfPossessionSeconds: number | null;
}

/** Combined kick + punt return yards. */
export function returnYards(g: Pick<GameStats, "kickReturnYards" | "puntReturnYards">): number {
  return (g.kickReturnYards || 0) + (g.puntReturnYards || 0);
}

