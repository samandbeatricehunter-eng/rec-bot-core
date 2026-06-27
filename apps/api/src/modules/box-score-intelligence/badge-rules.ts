// Pure badge-qualification rules. No DB, no side effects — every function is a
// deterministic predicate over the normalized inputs in types.ts, so the whole
// engine is unit-testable (scripts/badge-rules-verify.ts). The persistence and
// publishing layers consume `qualifyWeeklyBadges` / `qualifySeasonBadges` /
// `qualifyGlobalBadges` and the tiering helpers.
//
// Wording conventions from the blueprint:
//   "total offensive yards" = passing + rushing (offensiveYards)
//   "total yards"           = offense + returns   (totalYards)
//   "red zone offense"      = redZoneOffensivePct
//   third/fourth-down       = raw conversion counts (never attempts/percentage)

import {
  type BadgeTier,
  type CareerTotals,
  type GameStats,
  type SeasonTotals,
  returnYards,
} from "./types.js";

export interface BadgeDef<T> {
  key: string;
  label: string;
  description: string;
  qualifies: (input: T) => boolean;
}

// ─── Weekly badges (30) — qualified from a single uploaded game ────────────────

export const WEEKLY_BADGES: BadgeDef<GameStats>[] = [
  { key: "ground_and_pound", label: "Ground & Pound", description: "200+ rushing yards", qualifies: (g) => g.rushingYards >= 200 },
  { key: "run_heavy", label: "Run Heavy", description: "Rush yards exceeded pass yards by 75+", qualifies: (g) => g.rushingYards - g.passingYards >= 75 },
  { key: "air_raid", label: "Air Raid", description: "375+ passing yards", qualifies: (g) => g.passingYards >= 375 },
  { key: "pass_heavy", label: "Pass Heavy", description: "Pass yards exceeded rush yards by 200+", qualifies: (g) => g.passingYards - g.rushingYards >= 200 },
  { key: "balanced_attack", label: "Balanced Attack", description: "225+ passing AND 125+ rushing yards", qualifies: (g) => g.passingYards >= 225 && g.rushingYards >= 125 },
  { key: "total_control", label: "Total Control", description: "450+ total offensive yards", qualifies: (g) => g.offensiveYards >= 450 },
  { key: "nickel_and_dime", label: "Nickel & Dime", description: "24+ first downs and 8+ third down conversions", qualifies: (g) => g.firstDowns >= 24 && g.thirdDownConversions >= 8 },
  { key: "drive_extender", label: "Drive Extender", description: "10+ third down conversions", qualifies: (g) => g.thirdDownConversions >= 10 },
  { key: "chain_mover", label: "Chain Mover", description: "25+ first downs", qualifies: (g) => g.firstDowns >= 25 },
  { key: "fourth_down_gambler", label: "Fourth Down Gambler", description: "Converted 3+ fourth downs", qualifies: (g) => g.fourthDownConversions >= 3 },
  { key: "perfect_red_zone", label: "Perfect Red Zone", description: "100% red zone efficiency", qualifies: (g) => g.redZoneOffensivePct >= 100 },
  { key: "red_zone_efficient", label: "Red Zone Efficient", description: "75%+ red zone efficiency", qualifies: (g) => g.redZoneOffensivePct >= 75 },
  { key: "red_zone_wall", label: "Red Zone Wall", description: "Held opponent to 40% or less in the red zone", qualifies: (g) => g.opponentRedZoneOffensivePct <= 40 },
  {
    key: "bend_dont_break",
    label: "Bend Don't Break",
    description: "Won by ≤7 despite opponent getting 22+ first downs and 7+ third downs",
    qualifies: (g) => g.won && g.margin <= 7 && g.opponentFirstDowns >= 22 && g.opponentThirdDownConversions >= 7,
  },
  { key: "ball_security", label: "Ball Security", description: "Zero turnovers committed", qualifies: (g) => g.turnoversCommitted === 0 },
  { key: "turnover_trouble", label: "Turnover Trouble", description: "3+ turnovers committed", qualifies: (g) => g.turnoversCommitted >= 3 },
  { key: "turnover_survivor", label: "Turnover Survivor", description: "Won despite committing 3+ turnovers", qualifies: (g) => g.won && g.turnoversCommitted >= 3 },
  { key: "opportunistic", label: "Opportunistic", description: "Won by forcing 3+ opponent turnovers", qualifies: (g) => g.won && g.opponentTurnovers >= 3 },
  { key: "defensive_grind", label: "Defensive Grind", description: "Allowed 14 or fewer points", qualifies: (g) => g.pointsAgainst <= 14 },
  { key: "shootout_winner", label: "Shootout Winner", description: "Won while scoring 38+ points", qualifies: (g) => g.won && g.pointsFor >= 38 },
  { key: "statement_win", label: "Statement Win", description: "Won by 28+ points", qualifies: (g) => g.won && g.margin >= 28 },
  { key: "close_escape", label: "Close Escape", description: "Won by 3 or fewer points", qualifies: (g) => g.won && g.margin <= 3 },
  { key: "heartbreaker", label: "Heartbreaker", description: "Lost by 3 or fewer points", qualifies: (g) => g.lost && g.margin >= -3 },
  { key: "offensive_explosion", label: "Offensive Explosion", description: "Scored 45+ points", qualifies: (g) => g.pointsFor >= 45 },
  { key: "empty_yards", label: "Empty Yards", description: "400+ total yards but only 21 or fewer points scored", qualifies: (g) => g.totalYards >= 400 && g.pointsFor <= 21 },
  { key: "return_game_edge", label: "Return Game Edge", description: "150+ combined return yards", qualifies: (g) => returnYards(g) >= 150 },
  { key: "hidden_yardage", label: "Hidden Yardage", description: "200+ combined return yards", qualifies: (g) => returnYards(g) >= 200 },
  { key: "two_point_specialist", label: "Two-Point Specialist", description: "Converted 2+ two-point attempts", qualifies: (g) => g.twoPointConversions >= 2 },
  { key: "road_warrior", label: "Road Warrior", description: "Road win by 10+ points", qualifies: (g) => g.homeAway === "away" && g.won && g.margin >= 10 },
  { key: "home_fortress", label: "Home Fortress", description: "Home win by 10+ points", qualifies: (g) => g.homeAway === "home" && g.won && g.margin >= 10 },
];

// ─── Non-tiered season badges (20) — from season totals ────────────────────────

export const SEASON_BADGES: BadgeDef<SeasonTotals>[] = [
  { key: "ten_win_club", label: "10 Win Club", description: "Won 10+ games this season", qualifies: (s) => s.wins >= 10 },
  { key: "perfect_regular_season", label: "Perfect Regular Season", description: "Zero regular season losses", qualifies: (s) => s.regularSeasonGames > 0 && s.regularSeasonLosses === 0 },
  { key: "winning_season", label: "Winning Season", description: "Finished with more wins than losses", qualifies: (s) => s.wins > s.losses },
  { key: "air_commander", label: "Air Commander", description: "5,000+ passing yards this season", qualifies: (s) => s.passingYards >= 5000 },
  { key: "ground_commander", label: "Ground Commander", description: "2,000+ rushing yards this season", qualifies: (s) => s.rushingYards >= 2000 },
  { key: "balanced_season", label: "Balanced Season", description: "3,500+ passing AND 1,500+ rushing yards this season", qualifies: (s) => s.passingYards >= 3500 && s.rushingYards >= 1500 },
  { key: "chain_king", label: "Chain King", description: "350+ first downs this season", qualifies: (s) => s.firstDowns >= 350 },
  { key: "drive_sustainer", label: "Drive Sustainer", description: "120+ third down conversions this season", qualifies: (s) => s.thirdDownConversions >= 120 },
  { key: "fourth_down_menace", label: "Fourth Down Menace", description: "30+ fourth down conversions this season", qualifies: (s) => s.fourthDownConversions >= 30 },
  { key: "red_zone_master", label: "Red Zone Master", description: "80%+ season red zone efficiency", qualifies: (s) => s.seasonRedZoneOffPct >= 80 },
  { key: "red_zone_defense", label: "Red Zone Defense", description: "Held opponents to 45% or less in the red zone all season", qualifies: (s) => s.opponentSeasonRedZoneOffPct <= 45 },
  { key: "ball_control_season", label: "Ball Control Season", description: "12 or fewer turnovers all season", qualifies: (s) => s.turnoversCommitted <= 12 },
  { key: "giveaway_problem", label: "Giveaway Problem", description: "30+ turnovers committed this season", qualifies: (s) => s.turnoversCommitted >= 30 },
  { key: "takeaway_season", label: "Takeaway Season", description: "Forced 30+ opponent turnovers this season", qualifies: (s) => s.opponentTurnovers >= 30 },
  { key: "defensive_standard", label: "Defensive Standard", description: "Allowed 18 or fewer points per game this season", qualifies: (s) => s.gamesPlayed > 0 && s.pointsAgainst / s.gamesPlayed <= 18 },
  { key: "offensive_standard", label: "Offensive Standard", description: "Scored 35+ points per game this season", qualifies: (s) => s.gamesPlayed > 0 && s.pointsFor / s.gamesPlayed >= 35 },
  { key: "return_threat", label: "Return Threat", description: "2,000+ return yards this season", qualifies: (s) => s.returnYards >= 2000 },
  { key: "two_point_identity", label: "Two-Point Identity", description: "10+ two-point conversions this season", qualifies: (s) => s.twoPointConversions >= 10 },
  { key: "division_champion", label: "Division Champion", description: "Won the division title", qualifies: (s) => s.wonDivision },
  { key: "super_bowl_champion", label: "Super Bowl Champion", description: "Won the championship", qualifies: (s) => s.wonChampionship },
];

// ─── Global / career badges (50) — permanent ───────────────────────────────────

export const GLOBAL_BADGES: BadgeDef<CareerTotals>[] = [
  { key: "first_win", label: "First Win", description: "Earned your first career win", qualifies: (c) => c.wins >= 1 },
  { key: "wins_10", label: "10 Wins", description: "10+ career wins", qualifies: (c) => c.wins >= 10 },
  { key: "wins_25", label: "25 Wins", description: "25+ career wins", qualifies: (c) => c.wins >= 25 },
  { key: "wins_50", label: "50 Wins", description: "50+ career wins", qualifies: (c) => c.wins >= 50 },
  { key: "wins_100", label: "100 Wins", description: "100+ career wins", qualifies: (c) => c.wins >= 100 },
  { key: "wins_200", label: "200 Wins", description: "200+ career wins", qualifies: (c) => c.wins >= 200 },
  { key: "games_100", label: "100 Games", description: "Played 100+ career games", qualifies: (c) => c.gamesPlayed >= 100 },
  { key: "games_250", label: "250 Games", description: "Played 250+ career games", qualifies: (c) => c.gamesPlayed >= 250 },
  { key: "games_500", label: "500 Games", description: "Played 500+ career games", qualifies: (c) => c.gamesPlayed >= 500 },
  { key: "veteran_coach", label: "Veteran Coach", description: "Completed 10+ seasons", qualifies: (c) => c.seasonsCompleted >= 10 },
  { key: "air_milestone_1", label: "Air Milestone I", description: "10,000+ career passing yards", qualifies: (c) => c.passingYards >= 10000 },
  { key: "air_milestone_2", label: "Air Milestone II", description: "25,000+ career passing yards", qualifies: (c) => c.passingYards >= 25000 },
  { key: "air_milestone_3", label: "Air Milestone III", description: "50,000+ career passing yards", qualifies: (c) => c.passingYards >= 50000 },
  { key: "air_milestone_4", label: "Air Milestone IV", description: "75,000+ career passing yards", qualifies: (c) => c.passingYards >= 75000 },
  { key: "air_milestone_5", label: "Air Milestone V", description: "100,000+ career passing yards", qualifies: (c) => c.passingYards >= 100000 },
  { key: "ground_milestone_1", label: "Ground Milestone I", description: "5,000+ career rushing yards", qualifies: (c) => c.rushingYards >= 5000 },
  { key: "ground_milestone_2", label: "Ground Milestone II", description: "10,000+ career rushing yards", qualifies: (c) => c.rushingYards >= 10000 },
  { key: "ground_milestone_3", label: "Ground Milestone III", description: "20,000+ career rushing yards", qualifies: (c) => c.rushingYards >= 20000 },
  { key: "ground_milestone_4", label: "Ground Milestone IV", description: "30,000+ career rushing yards", qualifies: (c) => c.rushingYards >= 30000 },
  { key: "ground_milestone_5", label: "Ground Milestone V", description: "50,000+ career rushing yards", qualifies: (c) => c.rushingYards >= 50000 },
  { key: "chain_mover_1", label: "Chain Mover I", description: "500+ career first downs", qualifies: (c) => c.firstDowns >= 500 },
  { key: "chain_mover_2", label: "Chain Mover II", description: "1,000+ career first downs", qualifies: (c) => c.firstDowns >= 1000 },
  { key: "chain_mover_3", label: "Chain Mover III", description: "2,500+ career first downs", qualifies: (c) => c.firstDowns >= 2500 },
  { key: "chain_mover_4", label: "Chain Mover IV", description: "5,000+ career first downs", qualifies: (c) => c.firstDowns >= 5000 },
  { key: "chain_mover_5", label: "Chain Mover V", description: "10,000+ career first downs", qualifies: (c) => c.firstDowns >= 10000 },
  { key: "drive_extender_1", label: "Drive Extender I", description: "250+ career third down conversions", qualifies: (c) => c.thirdDownConversions >= 250 },
  { key: "drive_extender_2", label: "Drive Extender II", description: "500+ career third down conversions", qualifies: (c) => c.thirdDownConversions >= 500 },
  { key: "drive_extender_3", label: "Drive Extender III", description: "1,000+ career third down conversions", qualifies: (c) => c.thirdDownConversions >= 1000 },
  { key: "drive_extender_4", label: "Drive Extender IV", description: "1,500+ career third down conversions", qualifies: (c) => c.thirdDownConversions >= 1500 },
  { key: "fourth_down_believer", label: "Fourth Down Believer", description: "100+ career fourth down conversions", qualifies: (c) => c.fourthDownConversions >= 100 },
  { key: "fourth_down_legend", label: "Fourth Down Legend", description: "250+ career fourth down conversions", qualifies: (c) => c.fourthDownConversions >= 250 },
  { key: "red_zone_veteran", label: "Red Zone Veteran", description: "25+ games with 75%+ red zone efficiency", qualifies: (c) => c.gamesRedZone75 >= 25 },
  { key: "red_zone_killer", label: "Red Zone Killer", description: "100+ games with 75%+ red zone efficiency", qualifies: (c) => c.gamesRedZone75 >= 100 },
  { key: "red_zone_wall_career", label: "Red Zone Wall", description: "100+ games holding opponent to 40% or less in the red zone", qualifies: (c) => c.gamesOppRedZone40OrLess >= 100 },
  { key: "ball_security_veteran", label: "Ball Security Veteran", description: "25+ turnover-free games", qualifies: (c) => c.turnoverFreeGames >= 25 },
  { key: "ball_security_legend", label: "Ball Security Legend", description: "100+ turnover-free games", qualifies: (c) => c.turnoverFreeGames >= 100 },
  { key: "turnover_survivor_career", label: "Turnover Survivor", description: "Won 25+ games despite committing 3+ turnovers", qualifies: (c) => c.winsWith3PlusTurnovers >= 25 },
  { key: "opportunist", label: "Opportunist", description: "Won 50+ games by forcing 3+ opponent turnovers", qualifies: (c) => c.winsOpp3PlusTurnovers >= 50 },
  { key: "shootout_veteran", label: "Shootout Veteran", description: "Won 25+ games while scoring 38+ points", qualifies: (c) => c.winsScoring38Plus >= 25 },
  { key: "shootout_legend", label: "Shootout Legend", description: "Won 100+ games while scoring 38+ points", qualifies: (c) => c.winsScoring38Plus >= 100 },
  { key: "ground_and_pound_veteran", label: "Ground & Pound Veteran", description: "200+ rushing yards in 50+ career games", qualifies: (c) => c.games200PlusRush >= 50 },
  { key: "air_raid_veteran", label: "Air Raid Veteran", description: "375+ passing yards in 50+ career games", qualifies: (c) => c.games375PlusPass >= 50 },
  { key: "balanced_identity", label: "Balanced Identity", description: "50+ games with 225+ passing and 125+ rushing yards", qualifies: (c) => c.gamesBalanced >= 50 },
  { key: "nickel_and_dime_veteran", label: "Nickel & Dime Veteran", description: "50+ games with 24+ first downs and 8+ third downs", qualifies: (c) => c.gamesNickelDime >= 50 },
  { key: "bend_dont_break_veteran", label: "Bend Don't Break Veteran", description: "Won 25+ close games despite opponent first down/third down dominance", qualifies: (c) => c.bendDontBreakWins >= 25 },
  { key: "home_fortress_career", label: "Home Fortress", description: "50+ career home wins", qualifies: (c) => c.homeWins >= 50 },
  { key: "road_warrior_career", label: "Road Warrior", description: "50+ career road wins", qualifies: (c) => c.roadWins >= 50 },
  { key: "playoff_winner", label: "Playoff Winner", description: "10+ career playoff wins", qualifies: (c) => c.playoffWins >= 10 },
  { key: "champion", label: "Champion", description: "Won 1+ championships", qualifies: (c) => c.superBowlTitles >= 1 },
  { key: "dynasty", label: "Dynasty", description: "Won 3+ championships", qualifies: (c) => c.superBowlTitles >= 3 },
];

// ─── Qualification entry points ────────────────────────────────────────────────

export interface QualifiedBadge {
  key: string;
  label: string;
}

function qualify<T>(defs: BadgeDef<T>[], input: T): QualifiedBadge[] {
  return defs.filter((d) => d.qualifies(input)).map((d) => ({ key: d.key, label: d.label }));
}

export const qualifyWeeklyBadges = (g: GameStats): QualifiedBadge[] => qualify(WEEKLY_BADGES, g);
export const qualifySeasonBadges = (s: SeasonTotals): QualifiedBadge[] => qualify(SEASON_BADGES, s);
export const qualifyGlobalBadges = (c: CareerTotals): QualifiedBadge[] => qualify(GLOBAL_BADGES, c);

// ─── Tiering ───────────────────────────────────────────────────────────────────

/** Visual tier for a weekly badge based on its consecutive-week streak. */
export function getWeeklyTier(streak: number): BadgeTier {
  if (streak >= 4) return "gold";
  if (streak === 3) return "silver";
  if (streak === 2) return "bronze";
  return "normal";
}

/**
 * Season-long version of a repeated weekly badge.
 *   2 straight weeks → bronze, 3 → silver, 4+ → gold
 *   7 total earns in one season → xf (regardless of streak)
 * Returns null when the badge hasn't yet earned a season-long version.
 *
 * @param currentStreak     uninterrupted consecutive weekly earns
 * @param seasonEarnedCount total weekly earns this season (not necessarily consecutive)
 */
export function getSeasonTier(currentStreak: number, seasonEarnedCount: number): BadgeTier | null {
  if (seasonEarnedCount >= 7) return "xf";
  if (currentStreak >= 2) return getWeeklyTier(currentStreak);
  return null;
}
