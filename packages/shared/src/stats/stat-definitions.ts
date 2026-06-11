// ─────────────────────────────────────────────────────────────────────────────
// REC canonical stat definitions — the single source of truth for mapping
// Madden/EA import JSON keys into REC stat names, labels, categories, and usage.
//
// Rules:
//  1. canonicalKey is stable forever once introduced.
//  2. aliases include EA JSON names, staged DB names, older import names.
//  3. Award/payout/challenge logic must reference canonicalKey, never raw EA keys.
//  4. Some aliases (interceptions, sacks, passYards, rushYards, score) are
//     context-sensitive and are resolved by the normalizer using scope +
//     statCategory — see AMBIGUOUS_ALIASES in stat-normalizer.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type StatValueType =
  | "integer"
  | "number"
  | "percentage"
  | "yards"
  | "points"
  | "seconds"
  | "ratio"
  | "boolean";

export type StatScope = "player" | "team" | "game" | "league";

export type StatSide = "offense" | "defense" | "special_teams" | "general";

export type AggregationMode =
  | "sum"
  | "average"
  | "weighted_average"
  | "min"
  | "max"
  | "latest"
  | "derived";

export type StatUsage =
  | "import_preview"
  | "weekly_menu"
  | "game_channel"
  | "challenge"
  | "badge"
  | "award"
  | "eos_payout"
  | "leaderboard";

export interface StatDefinition {
  canonicalKey: string;
  label: string;
  shortLabel: string;
  description: string;
  scope: StatScope;
  side: StatSide;
  category: string;
  valueType: StatValueType;
  unit?: string;
  aliases: string[];
  aggregate: AggregationMode;
  higherIsBetter: boolean;
  defaultDisplay?: boolean;
  precision?: number;
  derived?: boolean;
  formula?: string;
  dependencies?: string[];
  usedFor: StatUsage[];
}

type DefInput = Partial<StatDefinition> &
  Pick<StatDefinition, "canonicalKey" | "label" | "scope" | "side" | "category" | "aggregate">;

function d(i: DefInput): StatDefinition {
  return {
    canonicalKey: i.canonicalKey,
    label: i.label,
    shortLabel: i.shortLabel ?? i.label,
    description: i.description ?? i.label,
    scope: i.scope,
    side: i.side,
    category: i.category,
    valueType: i.valueType ?? "integer",
    unit: i.unit,
    aliases: i.aliases ?? [],
    aggregate: i.aggregate,
    higherIsBetter: i.higherIsBetter ?? true,
    defaultDisplay: i.defaultDisplay,
    precision: i.precision,
    derived: i.derived,
    formula: i.formula,
    dependencies: i.dependencies,
    usedFor: i.usedFor ?? []
  };
}

// Recommended canonical stat categories.
export const STAT_CATEGORIES = [
  "passing",
  "rushing",
  "receiving",
  "defense",
  "kicking",
  "punting",
  "returns",
  "team_offense",
  "team_defense",
  "team_general",
  "game_result",
  "roster",
  "contract",
  "ratings"
] as const;

export type StatCategory = (typeof STAT_CATEGORIES)[number];

// ── Player offensive — passing ────────────────────────────────────────────────
const PASSING: StatDefinition[] = [
  d({ canonicalKey: "pass_attempts", label: "Pass Attempts", shortLabel: "Att", scope: "player", side: "offense", category: "passing", aggregate: "sum",
    aliases: ["passAttempts", "passingAttempts", "attempts", "att", "pass_att", "passAtt"], usedFor: ["award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "pass_completions", label: "Pass Completions", shortLabel: "Cmp", scope: "player", side: "offense", category: "passing", aggregate: "sum",
    aliases: ["passCompletions", "completions", "comp", "pass_cmp", "passComp"] }),
  d({ canonicalKey: "pass_yards", label: "Passing Yards", shortLabel: "Pass Yds", scope: "player", side: "offense", category: "passing", aggregate: "sum",
    valueType: "yards", unit: "yards", aliases: ["passYds", "passingYards", "pass_yds", "passing_yds", "passyds"], usedFor: ["challenge", "award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "pass_tds", label: "Passing Touchdowns", shortLabel: "Pass TD", scope: "player", side: "offense", category: "passing", aggregate: "sum",
    aliases: ["passTDs", "passingTDs", "passTouchdowns", "passing_touchdowns", "pass_td", "passing_tds"], usedFor: ["challenge", "award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "interceptions_thrown", label: "Interceptions Thrown", shortLabel: "INT", scope: "player", side: "offense", category: "passing", aggregate: "sum",
    higherIsBetter: false, aliases: ["passInts", "interceptionsThrown", "intsThrown", "pass_int", "passInterceptions"], usedFor: ["challenge", "eos_payout", "award"] }),
  d({ canonicalKey: "sacks_taken", label: "Sacks Taken", shortLabel: "Sacked", scope: "player", side: "offense", category: "passing", aggregate: "sum",
    higherIsBetter: false, aliases: ["sacksTaken", "timesSacked", "sackTaken", "passSacks"] }),
  d({ canonicalKey: "pass_long", label: "Longest Pass", shortLabel: "Lng", scope: "player", side: "offense", category: "passing", aggregate: "max",
    valueType: "yards", unit: "yards", aliases: ["passLong", "longestPass", "longPass", "passLongest"] }),
  d({ canonicalKey: "passer_rating", label: "Passer Rating", shortLabel: "Rtg", scope: "player", side: "offense", category: "passing", aggregate: "weighted_average",
    valueType: "number", precision: 1, aliases: ["passerRating", "qbRating", "rating"], usedFor: ["award", "leaderboard"] }),
  // derived
  d({ canonicalKey: "completion_pct", label: "Completion Percentage", shortLabel: "Cmp%", scope: "player", side: "offense", category: "passing", aggregate: "derived",
    valueType: "percentage", derived: true, formula: "pass_completions / pass_attempts * 100", dependencies: ["pass_completions", "pass_attempts"], usedFor: ["challenge", "award"] }),
  d({ canonicalKey: "yards_per_attempt", label: "Yards Per Attempt", shortLabel: "YPA", scope: "player", side: "offense", category: "passing", aggregate: "derived",
    valueType: "ratio", precision: 1, derived: true, formula: "pass_yards / pass_attempts", dependencies: ["pass_yards", "pass_attempts"], usedFor: ["award", "eos_payout"] })
];

// ── Player offensive — rushing ────────────────────────────────────────────────
const RUSHING: StatDefinition[] = [
  d({ canonicalKey: "rush_attempts", label: "Carries", shortLabel: "Car", scope: "player", side: "offense", category: "rushing", aggregate: "sum",
    aliases: ["rushAttempts", "rushingAttempts", "carries", "rush_att", "rushAtt"] }),
  d({ canonicalKey: "rush_yards", label: "Rushing Yards", shortLabel: "Rush Yds", scope: "player", side: "offense", category: "rushing", aggregate: "sum",
    valueType: "yards", unit: "yards", aliases: ["rushYds", "rushingYards", "rush_yds", "rushing_yds"], usedFor: ["challenge", "award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "rush_tds", label: "Rushing Touchdowns", shortLabel: "Rush TD", scope: "player", side: "offense", category: "rushing", aggregate: "sum",
    aliases: ["rushTDs", "rushingTDs", "rushTouchdowns", "rushing_touchdowns", "rush_td", "rushing_tds"], usedFor: ["award", "eos_payout", "leaderboard"], defaultDisplay: true }),
  d({ canonicalKey: "rush_long", label: "Longest Rush", shortLabel: "Lng", scope: "player", side: "offense", category: "rushing", aggregate: "max",
    valueType: "yards", unit: "yards", aliases: ["rushLong", "longestRush", "rushLongest"] }),
  d({ canonicalKey: "rushing_fumbles", label: "Rushing Fumbles", shortLabel: "Fum", scope: "player", side: "offense", category: "rushing", aggregate: "sum",
    higherIsBetter: false, aliases: ["rushFumbles", "fumbles", "fumLost", "rushFum"] }),
  // derived
  d({ canonicalKey: "yards_per_carry", label: "Yards Per Carry", shortLabel: "YPC", scope: "player", side: "offense", category: "rushing", aggregate: "derived",
    valueType: "ratio", precision: 1, derived: true, formula: "rush_yards / rush_attempts", dependencies: ["rush_yards", "rush_attempts"], usedFor: ["award", "eos_payout"] })
];

// ── Player offensive — receiving ──────────────────────────────────────────────
const RECEIVING: StatDefinition[] = [
  d({ canonicalKey: "receptions", label: "Receptions", shortLabel: "Rec", scope: "player", side: "offense", category: "receiving", aggregate: "sum",
    aliases: ["catches", "rec", "receivingReceptions", "recCatches"], usedFor: ["award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "receiving_yards", label: "Receiving Yards", shortLabel: "Rec Yds", scope: "player", side: "offense", category: "receiving", aggregate: "sum",
    valueType: "yards", unit: "yards", aliases: ["recYds", "recYards", "receivingYards", "receiving_yds", "rec_yds"], usedFor: ["award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "receiving_tds", label: "Receiving Touchdowns", shortLabel: "Rec TD", scope: "player", side: "offense", category: "receiving", aggregate: "sum",
    aliases: ["recTDs", "receivingTDs", "receivingTouchdowns", "rec_td", "receiving_tds"], usedFor: ["award", "eos_payout", "leaderboard"], defaultDisplay: true }),
  d({ canonicalKey: "receiving_long", label: "Longest Reception", shortLabel: "Lng", scope: "player", side: "offense", category: "receiving", aggregate: "max",
    valueType: "yards", unit: "yards", aliases: ["recLong", "receivingLong", "longestReception", "recLongest"] }),
  d({ canonicalKey: "receiving_drops", label: "Drops", shortLabel: "Drp", scope: "player", side: "offense", category: "receiving", aggregate: "sum",
    higherIsBetter: false, aliases: ["drops", "receivingDrops", "recDrops"] }),
  // derived
  d({ canonicalKey: "yards_per_reception", label: "Yards Per Reception", shortLabel: "YPR", scope: "player", side: "offense", category: "receiving", aggregate: "derived",
    valueType: "ratio", precision: 1, derived: true, formula: "receiving_yards / receptions", dependencies: ["receiving_yards", "receptions"], usedFor: ["award", "eos_payout"] })
];

// ── Player defensive ──────────────────────────────────────────────────────────
const DEFENSE: StatDefinition[] = [
  d({ canonicalKey: "tackles", label: "Tackles", shortLabel: "Tkl", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["totalTackles", "defTackles", "defTotalTackles"], usedFor: ["award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "solo_tackles", label: "Solo Tackles", shortLabel: "Solo", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["soloTackles", "solo"] }),
  d({ canonicalKey: "tackles_for_loss", label: "Tackles For Loss", shortLabel: "TFL", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["tacklesForLoss", "tfl", "defTFL", "defTacklesForLoss"], usedFor: ["award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "sacks", label: "Sacks", shortLabel: "Sk", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    valueType: "number", precision: 1, aliases: ["defSacks"], usedFor: ["challenge", "award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "interceptions", label: "Interceptions", shortLabel: "INT", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["defInts", "defInterceptions"], usedFor: ["challenge", "award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "forced_fumbles", label: "Forced Fumbles", shortLabel: "FF", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["forcedFumbles", "ff", "forceFumbles", "defForcedFum"], usedFor: ["award", "eos_payout"] }),
  d({ canonicalKey: "fumble_recoveries", label: "Fumble Recoveries", shortLabel: "FR", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["fumbleRecoveries", "fr", "recoveries", "defFumRec"] }),
  d({ canonicalKey: "pass_deflections", label: "Pass Deflections", shortLabel: "PD", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["passDeflections", "passDefended", "passBreakups", "pd", "pbu", "defDeflections"], usedFor: ["award", "leaderboard"] }),
  d({ canonicalKey: "defensive_tds", label: "Defensive Touchdowns", shortLabel: "Def TD", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["defensiveTDs", "defTDs", "defenseTouchdowns"], usedFor: ["award"] }),
  d({ canonicalKey: "safeties", label: "Safeties", shortLabel: "Sfty", scope: "player", side: "defense", category: "defense", aggregate: "sum",
    aliases: ["defSafeties"] })
];

// ── Kicking / special teams ───────────────────────────────────────────────────
const KICKING: StatDefinition[] = [
  d({ canonicalKey: "fg_made", label: "Field Goals Made", shortLabel: "FGM", scope: "player", side: "special_teams", category: "kicking", aggregate: "sum",
    aliases: ["fgMade", "fieldGoalsMade", "fgm", "fGMade"] }),
  d({ canonicalKey: "fg_attempts", label: "Field Goal Attempts", shortLabel: "FGA", scope: "player", side: "special_teams", category: "kicking", aggregate: "sum",
    aliases: ["fgAttempts", "fieldGoalsAttempted", "fga", "fGAtt"] }),
  d({ canonicalKey: "fg_long", label: "Longest Field Goal", shortLabel: "Lng", scope: "player", side: "special_teams", category: "kicking", aggregate: "max",
    valueType: "yards", unit: "yards", aliases: ["fgLong", "longestFieldGoal", "fGLongest", "fgLongest"], usedFor: ["eos_payout", "award"] }),
  d({ canonicalKey: "xp_made", label: "Extra Points Made", shortLabel: "XPM", scope: "player", side: "special_teams", category: "kicking", aggregate: "sum",
    aliases: ["xpMade", "extraPointsMade", "xpm", "xPMade"] }),
  d({ canonicalKey: "xp_attempts", label: "Extra Point Attempts", shortLabel: "XPA", scope: "player", side: "special_teams", category: "kicking", aggregate: "sum",
    aliases: ["xpAttempts", "extraPointsAttempted", "xpa", "xPAtt"] }),
  // derived
  d({ canonicalKey: "fg_pct", label: "Field Goal Percentage", shortLabel: "FG%", scope: "player", side: "special_teams", category: "kicking", aggregate: "derived",
    valueType: "percentage", derived: true, formula: "fg_made / fg_attempts * 100", dependencies: ["fg_made", "fg_attempts"], usedFor: ["award", "eos_payout"] }),
  d({ canonicalKey: "xp_pct", label: "Extra Point Percentage", shortLabel: "XP%", scope: "player", side: "special_teams", category: "kicking", aggregate: "derived",
    valueType: "percentage", derived: true, formula: "xp_made / xp_attempts * 100", dependencies: ["xp_made", "xp_attempts"], usedFor: ["eos_payout"] })
];

// ── Team offensive ────────────────────────────────────────────────────────────
const TEAM_OFFENSE: StatDefinition[] = [
  d({ canonicalKey: "points_for", label: "Points For", shortLabel: "PF", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    valueType: "points", aliases: ["pointsFor", "totalPoints"], usedFor: ["badge", "award", "eos_payout", "leaderboard", "game_channel"], defaultDisplay: true }),
  d({ canonicalKey: "total_offense_yards", label: "Total Offensive Yards", shortLabel: "Tot Yds", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    valueType: "yards", unit: "yards", aliases: ["totalYards", "offenseYards", "totalOffense", "total_offensive_yards"], usedFor: ["challenge", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "team_pass_yards", label: "Team Passing Yards", shortLabel: "Pass Yds", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    valueType: "yards", unit: "yards", aliases: ["teamPassYards"], usedFor: ["challenge", "eos_payout"] }),
  d({ canonicalKey: "team_rush_yards", label: "Team Rushing Yards", shortLabel: "Rush Yds", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    valueType: "yards", unit: "yards", aliases: ["teamRushYards"], usedFor: ["challenge", "eos_payout"] }),
  d({ canonicalKey: "first_downs", label: "First Downs", shortLabel: "1st Dn", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    aliases: ["firstDowns"], usedFor: ["challenge"] }),
  d({ canonicalKey: "red_zone_tds", label: "Red Zone Touchdowns", shortLabel: "RZ TD", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    aliases: ["offRedZoneTDs", "redZoneTDs"], usedFor: ["challenge", "leaderboard"] }),
  d({ canonicalKey: "turnovers", label: "Giveaways", shortLabel: "GA", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    higherIsBetter: false, aliases: ["giveaways", "teamTurnovers"], usedFor: ["challenge", "eos_payout"] }),
  d({ canonicalKey: "offensive_plays", label: "Offensive Plays", shortLabel: "Plays", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    aliases: ["offensivePlays", "plays"] }),
  d({ canonicalKey: "time_of_possession", label: "Time Of Possession", shortLabel: "TOP", scope: "team", side: "offense", category: "team_offense", aggregate: "sum",
    valueType: "seconds", aliases: ["timeOfPossession", "possessionTime", "top"], usedFor: ["challenge"] }),
  d({ canonicalKey: "games_played", label: "Games Played", shortLabel: "GP", scope: "team", side: "general", category: "team_general", aggregate: "sum",
    aliases: ["gamesPlayed", "games"] }),
  // derived
  d({ canonicalKey: "points_per_game", label: "Points Per Game", shortLabel: "PPG", scope: "team", side: "offense", category: "team_offense", aggregate: "derived",
    valueType: "number", precision: 1, derived: true, formula: "points_for / games_played", dependencies: ["points_for", "games_played"], usedFor: ["award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "yards_per_game", label: "Yards Per Game", shortLabel: "YPG", scope: "team", side: "offense", category: "team_offense", aggregate: "derived",
    valueType: "number", precision: 1, derived: true, formula: "total_offense_yards / games_played", dependencies: ["total_offense_yards", "games_played"], usedFor: ["eos_payout", "leaderboard"] })
];

// ── Team defensive ────────────────────────────────────────────────────────────
const TEAM_DEFENSE: StatDefinition[] = [
  d({ canonicalKey: "points_allowed", label: "Points Allowed", shortLabel: "PA", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    valueType: "points", higherIsBetter: false, aliases: ["pointsAllowed", "opponentPoints", "pointsAgainst", "oppScore"], usedFor: ["challenge", "badge", "award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "total_yards_allowed", label: "Total Yards Allowed", shortLabel: "Yds All", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    valueType: "yards", unit: "yards", higherIsBetter: false, aliases: ["yardsAllowed", "totalYardsAllowed", "opponentTotalYards"], usedFor: ["eos_payout", "leaderboard"] }),
  d({ canonicalKey: "pass_yards_allowed", label: "Passing Yards Allowed", shortLabel: "Pass All", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    valueType: "yards", unit: "yards", higherIsBetter: false, aliases: ["passYardsAllowed", "passingYardsAllowed", "opponentPassYards"], usedFor: ["challenge", "eos_payout"] }),
  d({ canonicalKey: "rush_yards_allowed", label: "Rushing Yards Allowed", shortLabel: "Rush All", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    valueType: "yards", unit: "yards", higherIsBetter: false, aliases: ["rushYardsAllowed", "rushingYardsAllowed", "opponentRushYards"], usedFor: ["challenge", "eos_payout"] }),
  d({ canonicalKey: "takeaways", label: "Takeaways", shortLabel: "TA", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    aliases: ["defensiveTurnovers", "turnoversForced"], usedFor: ["challenge", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "team_sacks", label: "Team Sacks", shortLabel: "Sk", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    valueType: "number", precision: 1, aliases: ["teamSacks", "defensiveSacks"], usedFor: ["challenge", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "team_interceptions", label: "Team Interceptions", shortLabel: "INT", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    aliases: ["teamInterceptions", "defensiveInterceptions"], usedFor: ["eos_payout", "challenge", "leaderboard"] }),
  d({ canonicalKey: "fumbles_forced_team", label: "Team Forced Fumbles", shortLabel: "FF", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    aliases: ["teamForcedFumbles"] }),
  d({ canonicalKey: "red_zone_tds_allowed", label: "Red Zone TDs Allowed", shortLabel: "RZ TD Alw", scope: "team", side: "defense", category: "team_defense", aggregate: "sum",
    higherIsBetter: false, aliases: ["defRedZoneTDs"], usedFor: ["challenge", "leaderboard"] }),
  // derived
  d({ canonicalKey: "points_allowed_per_game", label: "Points Allowed Per Game", shortLabel: "PAPG", scope: "team", side: "defense", category: "team_defense", aggregate: "derived",
    valueType: "number", precision: 1, higherIsBetter: false, derived: true, formula: "points_allowed / games_played", dependencies: ["points_allowed", "games_played"], usedFor: ["award", "eos_payout", "leaderboard"] }),
  d({ canonicalKey: "yards_allowed_per_game", label: "Yards Allowed Per Game", shortLabel: "YAPG", scope: "team", side: "defense", category: "team_defense", aggregate: "derived",
    valueType: "number", precision: 1, higherIsBetter: false, derived: true, formula: "total_yards_allowed / games_played", dependencies: ["total_yards_allowed", "games_played"], usedFor: ["eos_payout", "leaderboard"] })
];

// ── Game result / matchup ─────────────────────────────────────────────────────
const GAME_RESULT: StatDefinition[] = [
  d({ canonicalKey: "home_score", label: "Home Score", shortLabel: "Home", scope: "game", side: "general", category: "game_result", aggregate: "latest",
    valueType: "points", aliases: ["homeScore"] }),
  d({ canonicalKey: "away_score", label: "Away Score", shortLabel: "Away", scope: "game", side: "general", category: "game_result", aggregate: "latest",
    valueType: "points", aliases: ["awayScore"] }),
  d({ canonicalKey: "point_differential", label: "Point Differential", shortLabel: "Diff", scope: "game", side: "general", category: "game_result", aggregate: "sum",
    valueType: "integer", aliases: ["pointDifferential", "margin", "scoreMargin"], usedFor: ["badge", "award", "eos_payout"] }),
  d({ canonicalKey: "win", label: "Win", shortLabel: "W", scope: "game", side: "general", category: "game_result", aggregate: "sum",
    valueType: "boolean", aliases: ["won", "resultWin"] }),
  d({ canonicalKey: "loss", label: "Loss", shortLabel: "L", scope: "game", side: "general", category: "game_result", aggregate: "sum",
    valueType: "boolean", aliases: ["lost"] }),
  d({ canonicalKey: "tie", label: "Tie", shortLabel: "T", scope: "game", side: "general", category: "game_result", aggregate: "sum",
    valueType: "boolean", aliases: ["tied"] }),
  d({ canonicalKey: "h2h_game", label: "H2H Game", shortLabel: "H2H", scope: "game", side: "general", category: "game_result", aggregate: "sum",
    valueType: "boolean", aliases: ["isUserH2H", "is_user_h2h"] })
];

export const STAT_DEFINITIONS: StatDefinition[] = [
  ...PASSING,
  ...RUSHING,
  ...RECEIVING,
  ...DEFENSE,
  ...KICKING,
  ...TEAM_OFFENSE,
  ...TEAM_DEFENSE,
  ...GAME_RESULT
];

// ── Identity field maps (not stats — used for labeling) ───────────────────────
export const PLAYER_IDENTITY_ALIASES: Record<string, string> = {
  rosterId: "madden_player_id",
  playerId: "madden_player_id",
  id: "madden_player_id",
  firstName: "first_name",
  lastName: "last_name",
  fullName: "full_name",
  playerName: "full_name",
  player_display_name: "full_name",
  position: "position",
  jerseyNum: "jersey_number",
  age: "age",
  college: "college",
  height: "height_inches",
  weight: "weight_lbs",
  overallRating: "overall_rating",
  overall: "overall_rating",
  devTrait: "dev_trait",
  devtrait: "dev_trait",
  developmentTrait: "dev_trait",
  yearsPro: "years_pro",
  contractSalary: "contract_salary",
  contractBonus: "contract_bonus",
  contractYearsLeft: "contract_years_left"
};

export const TEAM_IDENTITY_ALIASES: Record<string, string> = {
  teamId: "madden_team_id",
  rosterId: "madden_team_id",
  external_team_id: "madden_team_id",
  team_external_id: "madden_team_id",
  displayName: "team_name",
  teamName: "team_name",
  cityName: "city_name",
  nickName: "nick_name",
  abbrName: "abbreviation",
  abbreviation: "abbreviation",
  conferenceName: "conference",
  divName: "division"
};
