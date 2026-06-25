// Unit checks for the box-score intelligence engine (badges + tiers + stories).
//
//   pnpm --filter @rec/api exec tsx scripts/badge-rules-verify.ts
//
// Pure logic, no DB — runs in milliseconds. Exits non-zero on any failed check.
import {
  WEEKLY_BADGES,
  SEASON_BADGES,
  GLOBAL_BADGES,
  qualifyWeeklyBadges,
  qualifySeasonBadges,
  qualifyGlobalBadges,
  getWeeklyTier,
  getSeasonTier,
  generateGameStory,
  rowToGameStats,
  type GameStats,
  type SeasonTotals,
  type CareerTotals,
  type TeamGameStatsRow,
} from "../src/modules/box-score-intelligence/index.js";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
};

const base: GameStats = {
  leagueId: "L", season: 1, week: 1, gameId: "g", teamId: "t", userId: "u", opponentTeamId: "o",
  won: true, lost: false, tied: false, homeAway: "home", pointsFor: 24, pointsAgainst: 17, margin: 7,
  isPlayoff: false, isSuperBowl: false,
  passingYards: 200, rushingYards: 100, offensiveYards: 300, totalYards: 300, firstDowns: 18,
  thirdDownConversions: 5, fourthDownConversions: 0, twoPointConversions: 0, turnoversCommitted: 1,
  redZoneOffensivePct: 50, kickReturnYards: 0, puntReturnYards: 0,
  opponentFirstDowns: 15, opponentThirdDownConversions: 4, opponentTurnovers: 0, opponentRedZoneOffensivePct: 50,
};
const g = (over: Partial<GameStats>): GameStats => ({ ...base, ...over });
const wonWeekly = (gs: GameStats, key: string) => qualifyWeeklyBadges(gs).some((b) => b.key === key);

// ── Set sizes ──────────────────────────────────────────────────────────────────
check("30 weekly badges", WEEKLY_BADGES.length === 30);
check("20 season badges", SEASON_BADGES.length === 20);
check("50 global badges", GLOBAL_BADGES.length === 50);
check("unique weekly keys", new Set(WEEKLY_BADGES.map((b) => b.key)).size === 30);
check("unique global keys", new Set(GLOBAL_BADGES.map((b) => b.key)).size === 50);

// ── Weekly thresholds (boundary on/off) ──────────────────────────────────────────
check("ground_and_pound @200", wonWeekly(g({ rushingYards: 200 }), "ground_and_pound"));
check("ground_and_pound !@199", !wonWeekly(g({ rushingYards: 199 }), "ground_and_pound"));
check("run_heavy @+75", wonWeekly(g({ rushingYards: 175, passingYards: 100 }), "run_heavy"));
check("air_raid @375", wonWeekly(g({ passingYards: 375 }), "air_raid"));
check("pass_heavy @+200", wonWeekly(g({ passingYards: 320, rushingYards: 120 }), "pass_heavy"));
check("balanced_attack", wonWeekly(g({ passingYards: 225, rushingYards: 125 }), "balanced_attack"));
check("total_control @450 off yards", wonWeekly(g({ offensiveYards: 450 }), "total_control"));
check("nickel_and_dime", wonWeekly(g({ firstDowns: 24, thirdDownConversions: 8 }), "nickel_and_dime"));
check("drive_extender @10", wonWeekly(g({ thirdDownConversions: 10 }), "drive_extender"));
check("chain_mover @25", wonWeekly(g({ firstDowns: 25 }), "chain_mover"));
check("fourth_down_gambler @3", wonWeekly(g({ fourthDownConversions: 3 }), "fourth_down_gambler"));
check("perfect_red_zone @100", wonWeekly(g({ redZoneOffensivePct: 100 }), "perfect_red_zone"));
check("red_zone_efficient @75", wonWeekly(g({ redZoneOffensivePct: 75 }), "red_zone_efficient"));
check("red_zone_wall opp<=40", wonWeekly(g({ opponentRedZoneOffensivePct: 40 }), "red_zone_wall"));
// Blueprint example
check(
  "bend_dont_break (blueprint example)",
  wonWeekly(g({ won: true, margin: 6, opponentFirstDowns: 22, opponentThirdDownConversions: 7 }), "bend_dont_break"),
);
check("bend_dont_break needs win", !wonWeekly(g({ won: false, lost: true, margin: -6, opponentFirstDowns: 22, opponentThirdDownConversions: 7 }), "bend_dont_break"));
check("ball_security @0 TO", wonWeekly(g({ turnoversCommitted: 0 }), "ball_security"));
check("turnover_survivor", wonWeekly(g({ won: true, turnoversCommitted: 3 }), "turnover_survivor"));
check("opportunistic", wonWeekly(g({ won: true, opponentTurnovers: 3 }), "opportunistic"));
check("defensive_grind <=14", wonWeekly(g({ pointsAgainst: 14 }), "defensive_grind"));
check("shootout_winner", wonWeekly(g({ won: true, pointsFor: 38 }), "shootout_winner"));
check("statement_win >=28", wonWeekly(g({ won: true, margin: 28 }), "statement_win"));
check("close_escape <=3", wonWeekly(g({ won: true, margin: 3 }), "close_escape"));
check("heartbreaker lose by 3", wonWeekly(g({ won: false, lost: true, margin: -3 }), "heartbreaker"));
check("heartbreaker !lose by 4", !wonWeekly(g({ won: false, lost: true, margin: -4 }), "heartbreaker"));
check("offensive_explosion @45", wonWeekly(g({ pointsFor: 45 }), "offensive_explosion"));
check("empty_yards 400 & <=21", wonWeekly(g({ totalYards: 400, pointsFor: 21 }), "empty_yards"));
check("return_game_edge 150", wonWeekly(g({ kickReturnYards: 100, puntReturnYards: 50 }), "return_game_edge"));
check("hidden_yardage 200", wonWeekly(g({ kickReturnYards: 120, puntReturnYards: 80 }), "hidden_yardage"));
check("two_point_specialist @2", wonWeekly(g({ twoPointConversions: 2 }), "two_point_specialist"));
check("road_warrior away +10", wonWeekly(g({ homeAway: "away", won: true, margin: 10 }), "road_warrior"));
check("home_fortress home +10", wonWeekly(g({ homeAway: "home", won: true, margin: 10 }), "home_fortress"));
check("road_warrior not at home", !wonWeekly(g({ homeAway: "home", won: true, margin: 10 }), "road_warrior"));

// ── Season badges ────────────────────────────────────────────────────────────────
const sBase: SeasonTotals = {
  wins: 8, losses: 9, ties: 0, gamesPlayed: 17, regularSeasonGames: 17, regularSeasonLosses: 9,
  passingYards: 3000, rushingYards: 1200, firstDowns: 300, thirdDownConversions: 90,
  fourthDownConversions: 10, twoPointConversions: 3, turnoversCommitted: 20, opponentTurnovers: 18,
  returnYards: 1000, pointsFor: 400, pointsAgainst: 380, seasonRedZoneOffPct: 60,
  opponentSeasonRedZoneOffPct: 60, wonDivision: false, wonChampionship: false,
};
const s = (over: Partial<SeasonTotals>) => ({ ...sBase, ...over });
const wonSeason = (st: SeasonTotals, key: string) => qualifySeasonBadges(st).some((b) => b.key === key);
check("ten_win_club @10", wonSeason(s({ wins: 10 }), "ten_win_club"));
check("perfect_regular_season", wonSeason(s({ regularSeasonLosses: 0 }), "perfect_regular_season"));
check("winning_season", wonSeason(s({ wins: 10, losses: 7 }), "winning_season"));
check("air_commander 5000", wonSeason(s({ passingYards: 5000 }), "air_commander"));
check("defensive_standard <=18 ppg", wonSeason(s({ pointsAgainst: 17 * 18, gamesPlayed: 17 }), "defensive_standard"));
check("offensive_standard >=35 ppg", wonSeason(s({ pointsFor: 17 * 35, gamesPlayed: 17 }), "offensive_standard"));
check("red_zone_defense opp<=45", wonSeason(s({ opponentSeasonRedZoneOffPct: 45 }), "red_zone_defense"));
check("super_bowl_champion", wonSeason(s({ wonChampionship: true }), "super_bowl_champion"));

// ── Global badges ────────────────────────────────────────────────────────────────
const cBase: CareerTotals = {
  wins: 0, gamesPlayed: 0, seasonsCompleted: 0, passingYards: 0, rushingYards: 0, firstDowns: 0,
  thirdDownConversions: 0, fourthDownConversions: 0, gamesRedZone75: 0, gamesOppRedZone40OrLess: 0,
  turnoverFreeGames: 0, winsWith3PlusTurnovers: 0, winsOpp3PlusTurnovers: 0, winsScoring38Plus: 0,
  games200PlusRush: 0, games375PlusPass: 0, gamesBalanced: 0, gamesNickelDime: 0, bendDontBreakWins: 0,
  homeWins: 0, roadWins: 0, playoffWins: 0, superBowlTitles: 0,
};
const c = (over: Partial<CareerTotals>) => ({ ...cBase, ...over });
const wonGlobal = (ct: CareerTotals, key: string) => qualifyGlobalBadges(ct).some((b) => b.key === key);
check("first_win @1", wonGlobal(c({ wins: 1 }), "first_win"));
check("wins_100", wonGlobal(c({ wins: 100 }), "wins_100"));
check("wins_100 implies wins_50", wonGlobal(c({ wins: 100 }), "wins_50"));
check("air_milestone_3 @50k", wonGlobal(c({ passingYards: 50000 }), "air_milestone_3"));
check("turnover_free veteran 25", wonGlobal(c({ turnoverFreeGames: 25 }), "ball_security_veteran"));
check("dynasty @3 titles", wonGlobal(c({ superBowlTitles: 3 }), "dynasty"));
check("champion @1 but not dynasty", wonGlobal(c({ superBowlTitles: 1 }), "champion") && !wonGlobal(c({ superBowlTitles: 1 }), "dynasty"));

// ── Tiering ──────────────────────────────────────────────────────────────────────
check("weekly tier 1=normal", getWeeklyTier(1) === "normal");
check("weekly tier 2=bronze", getWeeklyTier(2) === "bronze");
check("weekly tier 3=silver", getWeeklyTier(3) === "silver");
check("weekly tier 4=gold", getWeeklyTier(4) === "gold");
check("weekly tier 7=gold", getWeeklyTier(7) === "gold");
check("season tier streak1 = none", getSeasonTier(1, 1) === null);
check("season tier streak2 = bronze", getSeasonTier(2, 2) === "bronze");
check("season tier streak3 = silver", getSeasonTier(3, 3) === "silver");
check("season tier streak4 = gold", getSeasonTier(4, 4) === "gold");
check("season tier 7 earns = xf", getSeasonTier(1, 7) === "xf");
check("xf overrides streak", getSeasonTier(2, 7) === "xf");

// ── Story angle selection ────────────────────────────────────────────────────────
const winner = g({ won: true, rushingYards: 230, pointsFor: 34, pointsAgainst: 10, margin: 24 });
const loser = g({ won: false, lost: true, homeAway: "away", pointsFor: 10, pointsAgainst: 34, margin: -24, turnoversCommitted: 1 });
const story1 = generateGameStory({ winner, loser, winnerName: "Cowboys", loserName: "Lions" }, ["Ground & Pound"]);
check("story: ground-heavy win → ground_control", story1.primaryAngle === "ground_control");
check("story headline names teams", story1.headline.includes("Cowboys") && story1.headline.includes("Lions"));
check("story notes include earned badges", story1.notes.some((n) => n.includes("Ground & Pound")));

const bWinner = g({ won: true, margin: 6, pointsFor: 20, pointsAgainst: 14 });
const bLoser = g({ won: false, lost: true, margin: -6, pointsFor: 14, pointsAgainst: 20, firstDowns: 24, thirdDownConversions: 8, turnoversCommitted: 1 });
const story2 = generateGameStory({ winner: bWinner, loser: bLoser, winnerName: "Ravens", loserName: "Bengals" });
check("story: bend-dont-break wins the angle", story2.primaryAngle === "bend_dont_break");

// ── Row → GameStats mapper ───────────────────────────────────────────────────────
const row: TeamGameStatsRow = {
  league_id: "L", season_number: 2, week_number: 5, game_id: "g1", team_id: "t1", user_id: "u1", opponent_team_id: "o1",
  is_home: false, result: "win", points_for: 31, points_against: 20,
  off_pass_yards: 280, off_rush_yards: 140, off_yards_gained: 420, total_yards_gained: 455, off_first_down: 26,
  turnovers_committed: 0, red_zone_off_percentage: 80, kick_return_yards: 90, punt_return_yards: 70,
  generated_turnovers: 2, first_downs_allowed: 18, red_zone_def_percentage: 65,
  offensive_stats: { third_down_conversions: "9", fourth_down_conversions: "1", two_point_conversions: "0" },
  defensive_stats: { third_down_conversions: "5" },
};
const mapped = rowToGameStats(row);
check("map: thirdDown from JSONB", mapped.thirdDownConversions === 9);
check("map: opp third from defensive JSONB", mapped.opponentThirdDownConversions === 5);
check("map: opp red zone from def% (100-65)", mapped.opponentRedZoneOffensivePct === 35);
check("map: away + win", mapped.homeAway === "away" && mapped.won);
check("map: margin", mapped.margin === 11);
check("map: chain_mover qualifies (26 FD)", wonWeekly(mapped, "chain_mover"));

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
