// Normalized inputs for the box-score intelligence engine (badges + stories).
//
// These types are the contract between the persistence layer (which reads
// rec_team_game_stats: offensive columns + the opponent's mirrored stats +
// offensive_stats/defensive_stats JSONB) and the pure rule functions in
// badge-rules.ts / story-angles.ts.
//
// CFB-only fields are optional and null for Madden games — badges that need them
// must be tagged `games: CFB_27_ONLY` in badge-rules.ts so they never evaluate
// against a null on Madden.

export type BadgePolarity = "positive" | "negative";
/** Visual tier for a positive badge, driven by season occurrence count (see badge-rules.ts). */
export type BadgeTier = "normal" | "bronze" | "silver" | "gold";
/** Visual severity for a negative badge, driven by season occurrence count. */
export type NegativeBadgeSeverity = "needs_work" | "warning" | "serious_problem" | "shit_show";
/** Whether a badge's qualifying condition is checked per-game (resets each season) or against all-time career totals (never resets). */
export type BadgeEvalScope = "game" | "career";

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
  /** True if any raw stat for this game failed sanity validation (see game-profile.ts) — badges never evaluate against a quarantined game. */
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

/** Season-to-date totals for one team/user (badges whose condition is a season sum/average, not per-game). */
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
  wonChampionship: boolean;
  wonConferenceChampionship: boolean;
  wonDivisionalRound: boolean;
  /** CFB only — won any postseason bowl game. */
  wonAnyBowlGame: boolean;
  /** CFB only. */
  timeOfPossessionAvgSeconds: number | null;
}

/** All-time cumulative totals for one user within one league (career-scope badges — never reset). */
export interface CareerTotals {
  wins: number;
  gamesPlayed: number;
  seasonsCompleted: number;
  passingYards: number;
  rushingYards: number;
  firstDowns: number;
  fourthDownConversions: number;
  gamesRedZone75Plus: number;
  gamesOppRedZone40OrLess: number;
  games150PlusRush: number;
  games350PlusPass: number;
  playoffWins: number;
  playoffLosses: number;
  championships: number;
}
