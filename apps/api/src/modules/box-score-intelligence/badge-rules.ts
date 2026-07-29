// Pure badge-qualification rules. No DB, no side effects — every function is a
// deterministic predicate over the normalized inputs in types.ts.
//
// Three independent tracks, all sharing one BadgeDef shape + polarity, but differing
// in how the persistence layer tiers/resets them:
//   - GAME_BADGES:   qualified from a single game. Tiered by how many times this
//                    season a coach earned it (occurrence count) — see tierForCount
//                    below. Resets to 0 every new season. No streak tracking.
//   - SEASON_BADGES: qualified from a season's cumulative totals. Earned or not,
//                    always tier "normal". Resets every new season.
//   - CAREER_BADGES: qualified from all-time cumulative totals for this user in
//                    this league (never reset). Most are boolean/normal-tier;
//                    "ladder" badges (wins, games, yardage milestones) grade into
//                    bronze/silver/gold based on the highest threshold crossed.
//
// isCfb(game) branches are used wherever CFB's badge uses a different stat or
// threshold than Madden's for the "same" concept (e.g. run_heavy is yardage-based
// on Madden, attempt-count-based on CFB, because CFB's box score exposes rush/pass
// attempt counts Madden's doesn't).

import { isCfb, type LeagueGame } from "@rec/shared";
import { type BadgePolarity, type CareerTotals, type GameStats, type SeasonTotals, returnYards } from "./types.js";

export const CFB_27_ONLY = ["cfb_27"];
export const MADDEN_ONLY = ["madden_26", "madden_27"];

export interface BadgeDef<T> {
  key: string;
  label: string;
  description: string;
  polarity: BadgePolarity;
  games?: string[];
  qualifies: (input: T, game?: LeagueGame) => boolean;
  /** Renames the badge's displayed label above certain occurrence-tier thresholds (game-scope only). */
  tierLabels?: Partial<Record<"bronze" | "silver" | "gold", string>>;
}

/** One rung of a career-scope "ladder" badge (wins/games/yardage milestones). */
export interface LadderRung {
  value: number;
  tier: "bronze" | "silver" | "gold";
  label: string;
}

export interface LadderBadgeDef {
  key: string;
  description: string;
  games?: string[];
  statKey: (c: CareerTotals) => number;
  rungs: LadderRung[]; // ascending order
}

// A minimum-volume floor for percentage-based conditions — otherwise a 1-for-1 game
// would qualify for an efficiency badge/penalty exactly as hard as a 20-for-30 game.
const has = (n: number | null, min: number): n is number => n != null && n >= min;

// ─── Game-scope badges — qualified from a single game ─────────────────────────

const LEGACY_GAME_BADGES: BadgeDef<GameStats>[] = [
  // ── Positive: shared personality/playstyle ──
  {
    key: "run_heavy", label: "Run Heavy", polarity: "positive",
    description: "Rush-first identity for the game",
    qualifies: (g, game) => isCfb(game)
      ? has(g.rushAttempts, 1) && has(g.passAttempts, 0) && (g.rushAttempts! - 5) >= g.passAttempts!
      : g.rushingYards - g.passingYards >= 75,
  },
  {
    key: "pass_heavy", label: "Pass Heavy", polarity: "positive",
    description: "Pass-first identity for the game",
    qualifies: (g, game) => isCfb(game)
      ? has(g.passAttempts, 1) && has(g.rushAttempts, 0) && (g.passAttempts! - 20) >= g.rushAttempts!
      : g.passingYards - g.rushingYards >= 200,
  },
  {
    key: "balanced_attack", label: "Balanced Attack", polarity: "positive",
    description: "A genuinely balanced offensive attack",
    qualifies: (g, game) => isCfb(game)
      ? has(g.passAttempts, 1) && has(g.rushAttempts, 1) && Math.abs(g.passAttempts! - g.rushAttempts!) <= 10
      : g.passingYards >= 225 && g.rushingYards >= 125,
  },
  { key: "big_play_energy", label: "Big Play Energy", polarity: "positive", description: "450+ total offensive yards", qualifies: (g) => g.offensiveYards >= 450 },
  { key: "nickel_and_dime", label: "Nickel & Dime", polarity: "positive", description: "18+ first downs and 6+ third-down conversions", qualifies: (g) => g.firstDowns >= 18 && g.thirdDownConversions >= 6 },
  {
    key: "chain_mover", label: "Chain Mover", polarity: "positive", description: "Moved the chains all game",
    qualifies: (g, game) => isCfb(game)
      ? g.firstDowns >= 18 && has(g.thirdDownAttempts, 1) && (g.thirdDownConversions / g.thirdDownAttempts!) * 100 >= 80
      : g.firstDowns >= 20,
  },
  { key: "perfect_red_zone", label: "Perfect Red Zone", polarity: "positive", description: "100% red-zone efficiency", qualifies: (g) => g.redZoneOffensivePct >= 100 },
  { key: "red_zone_efficient", label: "Red Zone Efficient", polarity: "positive", description: "75%+ red-zone efficiency (not perfect)", qualifies: (g) => g.redZoneOffensivePct >= 75 && g.redZoneOffensivePct < 100 },
  {
    key: "red_zone_wall", label: "Red Zone Wall", polarity: "positive", description: "Held the opponent to 40% or less in the red zone",
    qualifies: (g) => g.opponentRedZoneOffensivePct <= 40,
    tierLabels: { gold: "Redzone Fortress" },
  },
  {
    key: "ball_security", label: "Ball Security", polarity: "positive", description: "Zero turnovers committed",
    qualifies: (g) => g.turnoversCommitted === 0,
    tierLabels: { silver: "Mistake Free", gold: "Mister Perfect" },
  },
  {
    key: "opportunistic", label: "Opportunistic", polarity: "positive", description: "Won by forcing 3+ opponent turnovers",
    qualifies: (g) => g.won && g.opponentTurnovers >= 3,
    tierLabels: { silver: "Opportunity Creator", gold: "Defensive Demon" },
  },
  { key: "defensive_grind", label: "Defensive Grind", polarity: "positive", description: "Allowed 14 or fewer points", qualifies: (g) => g.pointsAgainst <= 14 },
  { key: "shootout_winner", label: "Shootout Winner", polarity: "positive", description: "Won while scoring 38+ points", qualifies: (g) => g.won && g.pointsFor >= 38 },
  { key: "statement_win", label: "Statement Win", polarity: "positive", description: "Won by 28+ points", qualifies: (g) => g.won && g.margin >= 28 },
  { key: "close_escape", label: "Close Escape", polarity: "positive", description: "Won by 3 or fewer points", qualifies: (g) => g.won && g.margin <= 3 },
  { key: "offensive_explosion", label: "Offensive Explosion", polarity: "positive", description: "Scored 45+ points", qualifies: (g) => g.pointsFor >= 45 },
  { key: "empty_yards", label: "Empty Yards", polarity: "positive", description: "400+ total yards but 21 or fewer points scored", qualifies: (g) => g.totalYards >= 400 && g.pointsFor <= 21 },
  { key: "return_game_edge", label: "Return Game Edge", polarity: "positive", description: "150+ combined return yards", qualifies: (g) => returnYards(g) >= 150 },
  { key: "hidden_yardage", label: "Hidden Yardage", polarity: "positive", description: "200+ combined return yards", qualifies: (g) => returnYards(g) >= 200 },
  { key: "two_point_specialist", label: "Two-Point Specialist", polarity: "positive", description: "2+ successful two-point conversions", qualifies: (g) => g.twoPointConversions >= 2 },
  { key: "road_warrior", label: "Road Warrior", polarity: "positive", description: "Road win by 10+ points", qualifies: (g) => g.homeAway === "away" && g.won && g.margin >= 10 },
  { key: "home_fortress", label: "Home Fortress", polarity: "positive", description: "Home win by 10+ points", qualifies: (g) => g.homeAway === "home" && g.won && g.margin >= 10 },
  {
    key: "fourth_down_gambler", label: "Fourth Down Gambler", polarity: "positive", description: "Aggressive and successful on fourth down",
    qualifies: (g, game) => isCfb(game)
      ? has(g.fourthDownAttempts, 2) && (g.fourthDownConversions / g.fourthDownAttempts!) * 100 >= 80
      : g.fourthDownConversions >= 2,
  },
  {
    key: "bend_dont_break", label: "Bend Don't Break", polarity: "positive", description: "Won a close one despite the opponent moving the ball",
    qualifies: (g) => g.won && g.margin <= 7 && g.opponentFirstDowns >= 18 && g.opponentThirdDownConversions >= 6,
  },

  // ── Negative: Madden ──
  { key: "turnover_trouble", label: "Turnover Trouble", polarity: "negative", description: "Committed 3+ turnovers", games: MADDEN_ONLY, qualifies: (g) => g.turnoversCommitted >= 3 },
  { key: "heartbreaker", label: "Heartbreaker", polarity: "negative", description: "Lost by 3 or fewer points", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.margin >= -3 },
  { key: "offensive_stall", label: "Offensive Stall", polarity: "negative", description: "Lost while scoring 14 or fewer points", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.pointsFor <= 14 },
  { key: "ground_game_missing", label: "Ground Game Missing", polarity: "negative", description: "Lost while rushing for 50 or fewer yards", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.rushingYards <= 50 },
  { key: "chain_stalled", label: "Chain Stalled", polarity: "negative", description: "Lost with 10 or fewer first downs", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.firstDowns <= 10 },
  { key: "third_down_drought_m", label: "Third-Down Drought", polarity: "negative", description: "Lost with 2 or fewer third-down conversions", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.thirdDownConversions <= 2 },
  { key: "red_zone_woes", label: "Red Zone Woes", polarity: "negative", description: "Lost with 40% or lower red-zone efficiency", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.redZoneOffensivePct <= 40 },
  { key: "defensive_collapse", label: "Defensive Collapse", polarity: "negative", description: "Allowed 42+ points in a loss by more than 14", games: MADDEN_ONLY, qualifies: (g) => g.pointsAgainst >= 42 && g.lost && g.pointsAgainst - g.pointsFor > 14 },
  { key: "yardage_flood", label: "Floodgates Open", polarity: "negative", description: "Allowed 450+ offensive yards", games: MADDEN_ONLY, qualifies: (g) => has(g.yardsAllowed, 450) },
  { key: "blowout_victim_m", label: "Run Out of the Building", polarity: "negative", description: "Lost by 22 or more points", games: MADDEN_ONLY, qualifies: (g) => g.lost && g.margin <= -22 },

  // ── Negative: CFB ──
  { key: "turnover_trouble", label: "Turnover Trouble", polarity: "negative", description: "Committed 3+ total turnovers", games: CFB_27_ONLY, qualifies: (g) => g.turnoversCommitted >= 3 },
  { key: "pick_parade", label: "Pick Parade", polarity: "negative", description: "Threw 3+ interceptions", games: CFB_27_ONLY, qualifies: (g) => has(g.interceptionsThrown, 3) },
  { key: "butterfingers", label: "Butterfingers", polarity: "negative", description: "Lost 2+ fumbles", games: CFB_27_ONLY, qualifies: (g) => has(g.fumblesLost, 2) },
  { key: "completion_crisis", label: "Completion Crisis", polarity: "negative", description: "Completed under 50% on 20+ attempts", games: CFB_27_ONLY, qualifies: (g) => has(g.passAttempts, 20) && has(g.passCompletions, 0) && (g.passCompletions! / g.passAttempts!) * 100 < 50 },
  {
    key: "failed_attempts", label: "Failed Attempts", polarity: "negative", description: "8+ combined failed third/fourth-down attempts", games: CFB_27_ONLY,
    qualifies: (g) => {
      const failedThird = has(g.thirdDownAttempts, 0) ? g.thirdDownAttempts! - g.thirdDownConversions : 0;
      const failedFourth = has(g.fourthDownAttempts, 0) ? g.fourthDownAttempts! - g.fourthDownConversions : 0;
      return failedThird + failedFourth >= 8;
    },
  },
  { key: "third_down_drought", label: "Third-Down Drought", polarity: "negative", description: "25% or less on 8+ third-down attempts", games: CFB_27_ONLY, qualifies: (g) => has(g.thirdDownAttempts, 8) && (g.thirdDownConversions / g.thirdDownAttempts!) * 100 <= 25 },
  { key: "fourth_down_futility", label: "Fourth and Foolish", polarity: "negative", description: "Failed 3+ fourth-down attempts", games: CFB_27_ONLY, qualifies: (g) => has(g.fourthDownAttempts, 0) && (g.fourthDownAttempts! - g.fourthDownConversions) >= 3 },
  { key: "ground_game_grounded", label: "Grounded", polarity: "negative", description: "Under 3.0 yards/rush on 20+ attempts", games: CFB_27_ONLY, qualifies: (g) => has(g.rushAttempts, 20) && has(g.yardsPerRush, 0) && g.yardsPerRush! < 3.0 },
  { key: "passing_in_mud", label: "Passing in Mud", polarity: "negative", description: "5.5 or fewer yards/pass-attempt on 20+ attempts", games: CFB_27_ONLY, qualifies: (g) => has(g.passAttempts, 20) && has(g.yardsPerPass, 0) && g.yardsPerPass! <= 5.5 },
  { key: "inefficient_attack", label: "Inefficient Attack", polarity: "negative", description: "4.5 or fewer yards/play on 45+ plays", games: CFB_27_ONLY, qualifies: (g) => has(g.totalPlays, 45) && has(g.yardsPerPlay, 0) && g.yardsPerPlay! <= 4.5 },
  { key: "flag_factory", label: "Flag Factory", polarity: "negative", description: "8+ penalties or 75+ penalty yards", games: CFB_27_ONLY, qualifies: (g) => has(g.penalties, 8) || has(g.penaltyYards, 75) },
  { key: "punt_party", label: "Punt Party", polarity: "negative", description: "Punted 6+ times", games: CFB_27_ONLY, qualifies: (g) => has(g.punts, 6) },
  { key: "red_zone_waste", label: "Red Zone Waste", polarity: "negative", description: "40% or lower red zone while scoring 24 or fewer points", games: CFB_27_ONLY, qualifies: (g) => g.redZoneOffensivePct <= 40 && g.pointsFor <= 24 },
  { key: "touchdown_drought", label: "Touchdown Drought", polarity: "negative", description: "Zero offensive touchdowns, 17 or fewer points", games: CFB_27_ONLY, qualifies: (g) => has(g.rushTDs, 0) && has(g.passTDs, 0) && (g.rushTDs! + g.passTDs!) === 0 && g.pointsFor <= 17 },
  { key: "wasted_volume", label: "Wasted Volume", polarity: "negative", description: "65+ offensive plays but 21 or fewer points", games: CFB_27_ONLY, qualifies: (g) => has(g.totalPlays, 65) && g.pointsFor <= 21 },
  { key: "blowout_victim", label: "Run Out of the Stadium", polarity: "negative", description: "Lost by 28 or more points", games: CFB_27_ONLY, qualifies: (g) => g.lost && g.margin <= -28 },
];

// Badge v2 is intentionally untiered and contains only the catalog approved for the
// current product. The legacy definitions remain above temporarily as migration context,
// but are not exported or evaluated anywhere.
export const GAME_BADGES: BadgeDef<GameStats>[] = [
  { key: "statement_win", label: "Statement Win", polarity: "positive", description: "Win by at least 21 points.", qualifies: (g) => g.won && g.margin >= 21 },
  { key: "home_fortress", label: "Home Fortress", polarity: "positive", description: "Win at home by at least 14 points.", qualifies: (g) => g.won && g.homeAway === "home" && g.margin >= 14 },
  { key: "thirty_clip", label: "Thirty Clip", polarity: "positive", description: "Score at least 30 points.", qualifies: (g) => g.pointsFor >= 30 },
  { key: "forty_burger", label: "Forty Burger", polarity: "positive", description: "Score at least 40 points.", qualifies: (g) => g.pointsFor >= 40 },
  { key: "fifty_piece", label: "Fifty Piece", polarity: "positive", description: "Score at least 50 points.", qualifies: (g) => g.pointsFor >= 50 },
  { key: "sixty_minute_warning", label: "Sixty-Minute Warning", polarity: "positive", description: "Score at least 60 points.", qualifies: (g) => g.pointsFor >= 60 },
  { key: "double_up", label: "Double Up", polarity: "positive", description: "Score at least twice as many points as the opponent.", qualifies: (g) => g.pointsAgainst > 0 && g.pointsFor >= g.pointsAgainst * 2 },
  { key: "triple_threat", label: "Triple Threat", polarity: "positive", description: "Score at least three times as many points as the opponent.", qualifies: (g) => g.pointsAgainst > 0 && g.pointsFor >= g.pointsAgainst * 3 },
  { key: "air_raid", label: "Air Raid", polarity: "positive", description: "Record at least 350 passing yards.", qualifies: (g) => g.passingYards >= 350 },
  { key: "air_supremacy", label: "Air Supremacy", polarity: "positive", description: "Record at least 450 passing yards.", qualifies: (g) => g.passingYards >= 450 },
  { key: "five_century_club", label: "Five-Century Club", polarity: "positive", description: "Record at least 500 passing yards.", qualifies: (g) => g.passingYards >= 500 },
  { key: "clean_pocket", label: "Clean Pocket", polarity: "positive", description: "Record 300 passing yards without an interception.", qualifies: (g) => g.passingYards >= 300 && g.interceptionsThrown === 0 },
  { key: "completion_machine", label: "Completion Machine", polarity: "positive", description: "Complete at least 75% of 20 or more pass attempts.", games: CFB_27_ONLY, qualifies: (g) => has(g.passAttempts, 20) && has(g.passCompletions, 0) && g.passCompletions! / g.passAttempts! >= 0.75 },
  { key: "passing_clinic", label: "Passing Clinic", polarity: "positive", description: "Throw at least four touchdowns without an interception.", games: CFB_27_ONLY, qualifies: (g) => has(g.passTDs, 4) && g.interceptionsThrown === 0 },
  { key: "air_control", label: "Air Control", polarity: "positive", description: "Generate at least 70% of offensive yards through passing.", qualifies: (g) => g.offensiveYards > 0 && g.passingYards / g.offensiveYards >= 0.7 },
  { key: "bell_cow", label: "Bell Cow", polarity: "positive", description: "Rush for at least 150 yards.", qualifies: (g) => g.rushingYards >= 150 },
  { key: "ground_and_pound", label: "Ground and Pound", polarity: "positive", description: "Record at least 200 rushing yards.", qualifies: (g) => g.rushingYards >= 200 },
  { key: "runaway_train", label: "Runaway Train", polarity: "positive", description: "Record at least 300 rushing yards.", qualifies: (g) => g.rushingYards >= 300 },
  { key: "run_first_winner", label: "Run-First Winner", polarity: "positive", description: "Win with at least 60% of offensive yards on the ground.", qualifies: (g) => g.won && g.offensiveYards > 0 && g.rushingYards / g.offensiveYards >= 0.6 },
  { key: "goal_line_bully", label: "Goal-Line Bully", polarity: "positive", description: "Score at least three rushing touchdowns.", games: CFB_27_ONLY, qualifies: (g) => has(g.rushTDs, 3) },
  { key: "chain_gang", label: "Chain Gang", polarity: "positive", description: "Record at least 25 first downs.", qualifies: (g) => g.firstDowns >= 25 },
  { key: "first_down_flood", label: "First-Down Flood", polarity: "positive", description: "Record at least 30 first downs.", qualifies: (g) => g.firstDowns >= 30 },
  { key: "third_down_artist", label: "Third-Down Artist", polarity: "positive", description: "Convert at least eight third downs.", qualifies: (g) => g.thirdDownConversions >= 8 },
  { key: "third_down_royalty", label: "Third-Down Royalty", polarity: "positive", description: "Convert at least 10 third downs.", qualifies: (g) => g.thirdDownConversions >= 10 },
  { key: "fourth_down_fearless", label: "Fourth-Down Fearless", polarity: "positive", description: "Convert at least three fourth downs.", qualifies: (g) => g.fourthDownConversions >= 3 },
  { key: "fourth_and_perfect", label: "Fourth-and-Perfect", polarity: "positive", description: "Convert every fourth down with at least two attempts.", games: CFB_27_ONLY, qualifies: (g) => has(g.fourthDownAttempts, 2) && g.fourthDownConversions === g.fourthDownAttempts },
  { key: "drive_extender", label: "Drive Extender", polarity: "positive", description: "Record at least 12 combined third- and fourth-down conversions.", qualifies: (g) => g.thirdDownConversions + g.fourthDownConversions >= 12 },
  { key: "field_tilt", label: "Field Tilt", polarity: "positive", description: "Finish with at least 10 more first downs than the opponent.", qualifies: (g) => g.firstDowns - g.opponentFirstDowns >= 10 },
  { key: "red_zone_royalty", label: "Red-Zone Royalty", polarity: "positive", description: "Score touchdowns on every red-zone possession, minimum three.", games: CFB_27_ONLY, qualifies: (g) => has(g.redZoneTDs, 3) && g.redZoneFGs === 0 && g.redZoneOffensivePct >= 100 },
  { key: "red_zone_surgeon", label: "Red-Zone Surgeon", polarity: "positive", description: "Finish at 80% red-zone efficiency with four red-zone scores.", games: CFB_27_ONLY, qualifies: (g) => g.redZoneOffensivePct >= 80 && (g.redZoneTDs ?? 0) + (g.redZoneFGs ?? 0) >= 4 },
  { key: "no_empty_trips", label: "No Empty Trips", polarity: "positive", description: "Score on every red-zone possession.", qualifies: (g) => g.redZoneOffensivePct >= 100 },
  { key: "two_point_tactician", label: "Two-Point Tactician", polarity: "positive", description: "Convert at least two two-point attempts.", qualifies: (g) => g.twoPointConversions >= 2 },
  { key: "clean_sheet", label: "Clean Sheet", polarity: "positive", description: "Commit zero turnovers.", qualifies: (g) => g.turnoversCommitted === 0 },
  { key: "ball_security_pro", label: "Ball Security Pro", polarity: "positive", description: "Produce at least 400 offensive yards with one or fewer turnovers.", qualifies: (g) => g.offensiveYards >= 400 && g.turnoversCommitted <= 1 },
  { key: "ball_hawk", label: "Ball Hawk", polarity: "positive", description: "Force at least four turnovers.", qualifies: (g) => g.opponentTurnovers >= 4 },
  { key: "pick_party", label: "Pick Party", polarity: "positive", description: "Record at least three interceptions.", games: CFB_27_ONLY, qualifies: (g) => (g.opponentInterceptionsThrown ?? 0) >= 3 },
  { key: "strip_squad", label: "Strip Squad", polarity: "positive", description: "Recover at least three opponent fumbles.", games: CFB_27_ONLY, qualifies: (g) => (g.opponentFumblesLost ?? 0) >= 3 },
  { key: "turnover_tsunami", label: "Turnover Tsunami", polarity: "positive", description: "Force at least five turnovers.", qualifies: (g) => g.opponentTurnovers >= 5 },
  { key: "margin_master", label: "Margin Master", polarity: "positive", description: "Finish with a turnover margin of at least plus-four.", qualifies: (g) => g.opponentTurnovers - g.turnoversCommitted >= 4 },
  { key: "defensive_shutout", label: "Defensive Shutout", polarity: "positive", description: "Allow zero points.", qualifies: (g) => g.pointsAgainst === 0 },
  { key: "red_zone_lock", label: "Red-Zone Lock", polarity: "positive", description: "Allow no red-zone touchdowns on at least three trips.", qualifies: (g) => g.opponentRedZoneOffensivePct === 0 },
  { key: "third_down_dungeon", label: "Third-Down Dungeon", polarity: "positive", description: "Hold the opponent to 25% or lower on at least eight third-down attempts.", qualifies: (g) => has(g.opponentThirdDownAttempts, 8) && g.opponentThirdDownConversions / g.opponentThirdDownAttempts! <= 0.25 },
  { key: "fourth_down_stonewall", label: "Fourth-Down Stonewall", polarity: "positive", description: "Stop every opponent fourth down, minimum two attempts.", qualifies: (g) => has(g.opponentFourthDownAttempts, 2) && g.opponentFourthDownConversions === 0 },
  { key: "hidden_yardage", label: "Hidden Yardage", polarity: "positive", description: "Record at least 200 combined return yards.", qualifies: (g) => returnYards(g) >= 200 },
  { key: "kick_return_spark", label: "Kick Return Spark", polarity: "positive", description: "Record at least 150 kickoff-return yards.", qualifies: (g) => g.kickReturnYards >= 150 },
  { key: "punt_return_menace", label: "Punt Return Menace", polarity: "positive", description: "Record at least 75 punt-return yards.", qualifies: (g) => g.puntReturnYards >= 75 },
  { key: "special_teams_double", label: "Special Teams Double", polarity: "positive", description: "Record at least 50 kickoff- and punt-return yards.", qualifies: (g) => g.kickReturnYards >= 50 && g.puntReturnYards >= 50 },
  { key: "playoff_pressure", label: "Playoff Pressure", polarity: "positive", description: "Win a playoff game by one score.", qualifies: (g) => g.isPlayoff && g.won && g.margin <= 8 },
  { key: "championship_nerves", label: "Championship Nerves", polarity: "positive", description: "Win a championship game.", qualifies: (g) => g.isSuperBowl && g.won },
  { key: "escape_artist", label: "Escape Artist", polarity: "positive", description: "Win despite fewer total yards.", qualifies: (g) => g.won && g.totalYards < g.yardsAllowed },
  { key: "against_the_odds", label: "Against the Odds", polarity: "positive", description: "Win with a turnover margin of minus-two or worse.", qualifies: (g) => g.won && g.opponentTurnovers - g.turnoversCommitted <= -2 },
  { key: "bend_dont_break", label: "Bend, Don’t Break", polarity: "positive", description: "Win while allowing at least 20 first downs.", qualifies: (g) => g.won && g.opponentFirstDowns >= 20 },
  { key: "nickel_and_dime", label: "Nickel and Dime", polarity: "positive", description: "Record 20 first downs, six third-down conversions, and 150 rushing yards.", qualifies: (g) => g.firstDowns >= 20 && g.thirdDownConversions >= 6 && g.rushingYards >= 150 },
  { key: "complete_offense", label: "Complete Offense", polarity: "positive", description: "Record 300 passing and 150 rushing yards.", qualifies: (g) => g.passingYards >= 300 && g.rushingYards >= 150 },
  { key: "complete_team", label: "Complete Team", polarity: "positive", description: "Record 400 offensive yards, three takeaways, and 100 return yards.", qualifies: (g) => g.offensiveYards >= 400 && g.opponentTurnovers >= 3 && returnYards(g) >= 100 },
  { key: "statistical_anomaly", label: "Statistical Anomaly", polarity: "positive", description: "Win with fewer than 250 offensive yards.", qualifies: (g) => g.won && g.offensiveYards < 250 },
  { key: "perfect_storm", label: "Perfect Storm", polarity: "positive", description: "Score 40, commit no turnovers, force three, and exceed 80% red-zone efficiency.", qualifies: (g) => g.pointsFor >= 40 && g.turnoversCommitted === 0 && g.opponentTurnovers >= 3 && g.redZoneOffensivePct > 80 },
];

// ─── Season-scope badges — qualified from a season's cumulative totals ────────
// Always tier "normal". Reset every new season. "Reigning ___" badges are issued
// for the season AFTER the one they were won in — see issueReigningChampionBadges
// in persistence.ts, not qualifies() here (they need the PRIOR season's totals).

const LEGACY_SEASON_BADGES: BadgeDef<SeasonTotals>[] = [
  { key: "prolific_passer", label: "Prolific Passer", polarity: "positive", description: "5,000+ (Madden) / 4,000+ (CFB) passing yards this season", games: MADDEN_ONLY, qualifies: (s) => s.passingYards >= 5000 },
  { key: "prolific_passer", label: "Prolific Passer", polarity: "positive", description: "4,000+ passing yards this season", games: CFB_27_ONLY, qualifies: (s) => s.passingYards >= 4000 },
  { key: "prolific_rusher", label: "Prolific Rusher", polarity: "positive", description: "2,000+ (Madden) / 1,500+ (CFB) rushing yards this season", games: MADDEN_ONLY, qualifies: (s) => s.rushingYards >= 2000 },
  { key: "prolific_rusher", label: "Prolific Rusher", polarity: "positive", description: "1,500+ rushing yards this season", games: CFB_27_ONLY, qualifies: (s) => s.rushingYards >= 1500 },
  { key: "balanced_season", label: "Balanced Season", polarity: "positive", description: "3,500+ passing and 1,500+ rushing this season", games: MADDEN_ONLY, qualifies: (s) => s.passingYards >= 3500 && s.rushingYards >= 1500 },
  { key: "balanced_season", label: "Balanced Season", polarity: "positive", description: "2,500+ passing and 1,000+ rushing this season", games: CFB_27_ONLY, qualifies: (s) => s.passingYards >= 2500 && s.rushingYards >= 1000 },
  { key: "fourth_down_menace", label: "Fourth Down Menace", polarity: "positive", description: "20+ fourth-down conversions this season", qualifies: (s) => s.fourthDownConversions >= 20 },
  { key: "dawgin_em", label: "Dawg In 'Em", polarity: "positive", description: "25+ forced opponent turnovers this season", qualifies: (s) => s.opponentTurnovers >= 25 },
  { key: "two_point_identity", label: "Two-Point Identity", polarity: "positive", description: "10+ two-point conversions this season", qualifies: (s) => s.twoPointConversions >= 10 },
  { key: "clock_bleeder", label: "Clock Bleeder", polarity: "positive", description: "18+ minute average time of possession this season", games: CFB_27_ONLY, qualifies: (s) => (s.timeOfPossessionAvgSeconds ?? 0) >= 18 * 60 },
  { key: "perfect_regular_season", label: "Perfect Regular Season", polarity: "positive", description: "Zero regular-season losses", qualifies: (s) => s.regularSeasonGames > 0 && s.regularSeasonLosses === 0 },
  { key: "winning_season", label: "Winning Season", polarity: "positive", description: "More than 8 wins this season", games: MADDEN_ONLY, qualifies: (s) => s.wins > 8 },
  { key: "return_threat", label: "Return Threat", polarity: "positive", description: "1,000+ combined return yards this season", qualifies: (s) => s.returnYards >= 1000 },
];

export const SEASON_BADGES: BadgeDef<SeasonTotals>[] = [
  { key: "flawless_campaign", label: "Flawless Campaign", polarity: "positive", description: "Finish the regular season undefeated.", qualifies: (s) => s.regularSeasonGames > 0 && s.regularSeasonLosses === 0 },
  { key: "unblemished_champion", label: "Unblemished Champion", polarity: "positive", description: "Complete an undefeated championship season.", qualifies: (s) => s.losses === 0 && s.wonChampionship },
  { key: "one_loss_wonder", label: "One-Loss Wonder", polarity: "positive", description: "Finish the regular season with one loss or fewer.", qualifies: (s) => s.regularSeasonGames > 0 && s.regularSeasonLosses <= 1 },
  { key: "ten_win_club", label: "Ten-Win Club", polarity: "positive", description: "Win at least 10 games.", qualifies: (s) => s.wins >= 10 },
  { key: "the_750_standard", label: "The .750 Standard", polarity: "positive", description: "Win at least 75% of games.", qualifies: (s) => s.gamesPlayed > 0 && s.wins / s.gamesPlayed >= 0.75 },
  { key: "five_hundred_club", label: "Five-Hundred Club", polarity: "positive", description: "Score at least 500 points.", qualifies: (s) => s.pointsFor >= 500 },
  { key: "six_hundred_club", label: "Six-Hundred Club", polarity: "positive", description: "Score at least 600 points.", qualifies: (s) => s.pointsFor >= 600 },
  { key: "seven_hundred_club", label: "Seven-Hundred Club", polarity: "positive", description: "Score at least 700 points.", qualifies: (s) => s.pointsFor >= 700 },
  { key: "thirty_per_game", label: "Thirty Per Game", polarity: "positive", description: "Average at least 30 points.", qualifies: (s) => s.gamesPlayed > 0 && s.pointsFor / s.gamesPlayed >= 30 },
  { key: "forty_per_game", label: "Forty Per Game", polarity: "positive", description: "Average at least 40 points.", qualifies: (s) => s.gamesPlayed > 0 && s.pointsFor / s.gamesPlayed >= 40 },
  { key: "margin_machine", label: "Margin Machine", polarity: "positive", description: "Finish with a point differential of at least plus-200.", qualifies: (s) => s.pointsFor - s.pointsAgainst >= 200 },
  { key: "four_thousand_club", label: "Four-Thousand Club", polarity: "positive", description: "Record at least 4,000 passing yards.", qualifies: (s) => s.passingYards >= 4000 },
  { key: "five_thousand_club", label: "Five-Thousand Club", polarity: "positive", description: "Record at least 5,000 passing yards.", qualifies: (s) => s.passingYards >= 5000 },
  { key: "six_thousand_club", label: "Six-Thousand Club", polarity: "positive", description: "Record at least 6,000 passing yards.", qualifies: (s) => s.passingYards >= 6000 },
  { key: "air_and_ground", label: "Air and Ground", polarity: "positive", description: "Finish with 4,000 passing and 1,000 rushing yards.", qualifies: (s) => s.passingYards >= 4000 && s.rushingYards >= 1000 },
  { key: "two_thousand_club", label: "Two-Thousand Club", polarity: "positive", description: "Record at least 2,000 rushing yards.", qualifies: (s) => s.rushingYards >= 2000 },
  { key: "three_thousand_club", label: "Three-Thousand Club", polarity: "positive", description: "Record at least 3,000 rushing yards.", qualifies: (s) => s.rushingYards >= 3000 },
  { key: "four_thousand_ground_club", label: "Four-Thousand Club", polarity: "positive", description: "Record at least 4,000 rushing yards.", qualifies: (s) => s.rushingYards >= 4000 },
  { key: "one_fifty_per_game", label: "One-Fifty Per Game", polarity: "positive", description: "Average at least 150 rushing yards.", qualifies: (s) => s.gamesPlayed > 0 && s.rushingYards / s.gamesPlayed >= 150 },
  { key: "under_twenty", label: "Under Twenty", polarity: "positive", description: "Allow fewer than 20 points per game.", qualifies: (s) => s.gamesPlayed > 0 && s.pointsAgainst / s.gamesPlayed < 20 },
  { key: "under_fifteen", label: "Under Fifteen", polarity: "positive", description: "Allow fewer than 15 points per game.", qualifies: (s) => s.gamesPlayed > 0 && s.pointsAgainst / s.gamesPlayed < 15 },
  { key: "playoff_ticket", label: "Playoff Ticket", polarity: "positive", description: "Qualify for the playoffs.", qualifies: (s) => s.wonDivisionalRound || s.wonConferenceChampionship || s.wonAnyBowlGame || s.wonChampionship },
  { key: "league_champion", label: "League Champion", polarity: "positive", description: "Win the championship.", qualifies: (s) => s.wonChampionship },
  { key: "conference_crown", label: "Conference Crown", polarity: "positive", description: "Win the conference championship.", qualifies: (s) => s.wonConferenceChampionship },
];

// ─── Career-scope badges — all-time cumulative per user per league (never reset) ──
// Simple boolean/threshold badges, always tier "normal" unless noted.

const LEGACY_CAREER_BADGES: BadgeDef<CareerTotals>[] = [
  { key: "veteran_coach", label: "REC League Veteran", polarity: "positive", description: "100+ career games played", qualifies: (c) => c.gamesPlayed >= 100 },
  { key: "fourth_down_legend", label: "4th Down Legend", polarity: "positive", description: "200+ career fourth-down conversions", games: MADDEN_ONLY, qualifies: (c) => c.fourthDownConversions >= 200 },
  { key: "fourth_down_legend", label: "4th Down Legend", polarity: "positive", description: "100+ career fourth-down conversions at 80%+", games: CFB_27_ONLY, qualifies: (c) => c.fourthDownConversions >= 100 },
  { key: "red_zone_legend", label: "Red Zone Legend", polarity: "positive", description: "25+ games at 85%+ red zone efficiency and 25+ games holding opponents to 40% or less", qualifies: (c) => c.gamesRedZone75Plus >= 25 && c.gamesOppRedZone40OrLess >= 25 },
  { key: "ground_and_pound_veteran", label: "Run Game Veteran", polarity: "positive", description: "50+ career games with 150+ rushing yards", qualifies: (c) => c.games150PlusRush >= 50 },
  { key: "air_raid_veteran", label: "Pass Game Veteran", polarity: "positive", description: "50+ career games with 350+ passing yards", qualifies: (c) => c.games350PlusPass >= 50 },
  { key: "playoff_winner", label: "Playoff Winner", polarity: "positive", description: "50%+ career playoff win rate (min. 4 playoff games)", qualifies: (c) => c.playoffWins + c.playoffLosses >= 4 && c.playoffWins / (c.playoffWins + c.playoffLosses) >= 0.5 },
  { key: "dynasty_builder", label: "Dynasty Builder", polarity: "positive", description: "3+ career championships", qualifies: (c) => c.championships >= 3 },
];

export const CAREER_BADGES: BadgeDef<CareerTotals>[] = [
  { key: "first_playoff_win", label: "First Playoff Win", polarity: "positive", description: "Earn the first postseason victory.", qualifies: (c) => c.playoffWins >= 1 },
  { key: "playoff_tested", label: "Playoff Tested", polarity: "positive", description: "Reach 10 playoff wins.", qualifies: (c) => c.playoffWins >= 10 },
  { key: "playoff_veteran", label: "Playoff Veteran", polarity: "positive", description: "Reach 25 playoff wins.", qualifies: (c) => c.playoffWins >= 25 },
  { key: "playoff_legend", label: "Playoff Legend", polarity: "positive", description: "Reach 50 playoff wins.", qualifies: (c) => c.playoffWins >= 50 },
  { key: "first_ring", label: "First Ring", polarity: "positive", description: "Win the first league championship.", qualifies: (c) => c.championships >= 1 },
  { key: "three_ring_club", label: "Three-Ring Club", polarity: "positive", description: "Win three league championships.", qualifies: (c) => c.championships >= 3 },
  { key: "five_ring_club", label: "Five-Ring Club", polarity: "positive", description: "Win five league championships.", qualifies: (c) => c.championships >= 5 },
  { key: "ten_ring_club", label: "Ten-Ring Club", polarity: "positive", description: "Win 10 league championships.", qualifies: (c) => c.championships >= 10 },
  { key: "ten_thousand_air_miles", label: "Ten-Thousand Air Miles", polarity: "positive", description: "Record 10,000 career passing yards.", qualifies: (c) => c.passingYards >= 10000 },
  { key: "twenty_five_thousand_air_miles", label: "Twenty-Five Thousand Air Miles", polarity: "positive", description: "Record 25,000 career passing yards.", qualifies: (c) => c.passingYards >= 25000 },
  { key: "fifty_thousand_air_miles", label: "Fifty-Thousand Air Miles", polarity: "positive", description: "Record 50,000 career passing yards.", qualifies: (c) => c.passingYards >= 50000 },
  { key: "one_hundred_thousand_air_miles", label: "One-Hundred Thousand Air Miles", polarity: "positive", description: "Record 100,000 career passing yards.", qualifies: (c) => c.passingYards >= 100000 },
  { key: "five_thousand_ground_miles", label: "Five-Thousand Ground Miles", polarity: "positive", description: "Record 5,000 career rushing yards.", qualifies: (c) => c.rushingYards >= 5000 },
  { key: "ten_thousand_ground_miles", label: "Ten-Thousand Ground Miles", polarity: "positive", description: "Record 10,000 career rushing yards.", qualifies: (c) => c.rushingYards >= 10000 },
  { key: "twenty_five_thousand_ground_miles", label: "Twenty-Five Thousand Ground Miles", polarity: "positive", description: "Record 25,000 career rushing yards.", qualifies: (c) => c.rushingYards >= 25000 },
  { key: "fifty_thousand_ground_miles", label: "Fifty-Thousand Ground Miles", polarity: "positive", description: "Record 50,000 career rushing yards.", qualifies: (c) => c.rushingYards >= 50000 },
  { key: "one_thousand_first_downs", label: "One-Thousand First Downs", polarity: "positive", description: "Record 1,000 career first downs.", qualifies: (c) => c.firstDowns >= 1000 },
  { key: "twenty_five_hundred_first_downs", label: "Twenty-Five Hundred First Downs", polarity: "positive", description: "Record 2,500 career first downs.", qualifies: (c) => c.firstDowns >= 2500 },
  { key: "five_thousand_first_downs", label: "Five-Thousand First Downs", polarity: "positive", description: "Record 5,000 career first downs.", qualifies: (c) => c.firstDowns >= 5000 },
  { key: "fourth_down_gambler", label: "Fourth-Down Gambler", polarity: "positive", description: "Convert 250 career fourth downs.", qualifies: (c) => c.fourthDownConversions >= 250 },
  { key: "winning_tradition", label: "Winning Tradition", polarity: "positive", description: "Maintain a winning career record after 100 games.", qualifies: (c) => c.gamesPlayed >= 100 && c.wins / c.gamesPlayed > 0.5 },
  { key: "elite_standard", label: "Elite Standard", polarity: "positive", description: "Maintain a .650 winning percentage after 100 games.", qualifies: (c) => c.gamesPlayed >= 100 && c.wins / c.gamesPlayed >= 0.65 },
  { key: "juggernaut", label: "Juggernaut", polarity: "positive", description: "Maintain a .750 winning percentage after 100 games.", qualifies: (c) => c.gamesPlayed >= 100 && c.wins / c.gamesPlayed >= 0.75 },
];

/** Career-scope "ladder" badges — one badge, tier grades with the highest threshold crossed. */
const LEGACY_CAREER_LADDER_BADGES: LadderBadgeDef[] = [
  {
    key: "wins_milestone", description: "Career wins milestone", statKey: (c) => c.wins,
    rungs: [
      { value: 10, tier: "bronze", label: "10 Wins" }, { value: 25, tier: "bronze", label: "25 Wins" },
      { value: 50, tier: "bronze", label: "50 Wins" }, { value: 100, tier: "bronze", label: "100 Wins" },
      { value: 200, tier: "silver", label: "200 Wins" }, { value: 500, tier: "silver", label: "500 Wins" },
      { value: 1000, tier: "gold", label: "1,000 Wins" },
    ],
  },
  {
    key: "games_milestone", description: "Career games-played milestone", statKey: (c) => c.gamesPlayed,
    rungs: [
      { value: 100, tier: "bronze", label: "100 Games" }, { value: 250, tier: "bronze", label: "250 Games" },
      { value: 500, tier: "silver", label: "500 Games" }, { value: 1000, tier: "silver", label: "1,000 Games" },
      { value: 5000, tier: "gold", label: "5,000+ Games" },
    ],
  },
  {
    key: "air_milestone", description: "Career passing-yards milestone", statKey: (c) => c.passingYards,
    rungs: [
      { value: 10000, tier: "bronze", label: "Air Milestone I" }, { value: 25000, tier: "bronze", label: "Air Milestone II" },
      { value: 50000, tier: "silver", label: "Air Milestone III" }, { value: 75000, tier: "silver", label: "Air Milestone IV" },
      { value: 100000, tier: "gold", label: "Air Milestone V" },
    ],
  },
  {
    key: "ground_milestone", description: "Career rushing-yards milestone", statKey: (c) => c.rushingYards,
    rungs: [
      { value: 5000, tier: "bronze", label: "Ground Milestone I" }, { value: 10000, tier: "bronze", label: "Ground Milestone II" },
      { value: 20000, tier: "silver", label: "Ground Milestone III" }, { value: 30000, tier: "silver", label: "Ground Milestone IV" },
      { value: 50000, tier: "gold", label: "Ground Milestone V" },
    ],
  },
];

export const CAREER_LADDER_BADGES: LadderBadgeDef[] = [];

// ─── Qualification entry points ────────────────────────────────────────────────

export interface QualifiedBadge {
  key: string;
  label: string;
  polarity: BadgePolarity;
}

function isBadgeAvailableForGame<T>(badge: BadgeDef<T>, game?: string | null) {
  return !badge.games?.length || badge.games.includes(String(game ?? "madden_26"));
}

function qualify<T>(defs: BadgeDef<T>[], input: T, game?: string | null): QualifiedBadge[] {
  return defs.filter((d) => isBadgeAvailableForGame(d, game) && d.qualifies(input, game)).map((d) => ({ key: d.key, label: d.label, polarity: d.polarity }));
}

export const qualifyGameBadges = (g: GameStats, game?: string | null): QualifiedBadge[] => qualify(GAME_BADGES, g, game);
export const qualifySeasonBadges = (s: SeasonTotals, game?: string | null): QualifiedBadge[] => qualify(SEASON_BADGES, s, game);
export const qualifyCareerBadges = (c: CareerTotals, game?: string | null): QualifiedBadge[] => qualify(CAREER_BADGES, c, game);

export interface QualifiedLadderBadge {
  key: string;
  label: string;
  tier: "bronze" | "silver" | "gold";
}

/** For each ladder badge, the highest rung crossed (or none). */
export function qualifyLadderBadges(c: CareerTotals, game?: string | null): QualifiedLadderBadge[] {
  const out: QualifiedLadderBadge[] = [];
  for (const ladder of CAREER_LADDER_BADGES) {
    if (ladder.games?.length && !ladder.games.includes(String(game ?? "madden_26"))) continue;
    const value = ladder.statKey(c);
    const reached = [...ladder.rungs].reverse().find((rung) => value >= rung.value);
    if (reached) out.push({ key: ladder.key, label: reached.label, tier: reached.tier });
  }
  return out;
}

/** The highest rung a plain numeric value crosses, or null. Shared by financial-badges.ts, which isn't derived from GameStats/CareerTotals at all (dollar ledger + purchases instead). */
export function highestRungCrossed(value: number, rungs: LadderRung[]): LadderRung | null {
  return [...rungs].reverse().find((rung) => value >= rung.value) ?? null;
}

/**
 * Ladder badges rename per tier (e.g. "earner" is "Money Man" at bronze, "Big Bank" at
 * gold) — a flat badge_key -> label map can't express that. Any consumer displaying a
 * ladder-badge ownership row (which always has both badge_key and tier) should call
 * this instead of a static label lookup.
 */
export function ladderLabelForTier(badgeKey: string, tier: string): string | null {
  const ladders: Array<{ key: string; rungs: LadderRung[] }> = [
    ...CAREER_LADDER_BADGES.map((l) => ({ key: l.key, rungs: l.rungs })),
    { key: "earner", rungs: EARNER_RUNGS },
    { key: "spender", rungs: SPENDER_RUNGS },
    { key: "saver", rungs: SAVER_RUNGS },
    { key: "attribute_purchase", rungs: ATTRIBUTE_PURCHASE_RUNGS },
    { key: "dev_upgrade_purchase", rungs: DEV_UPGRADE_PURCHASE_RUNGS },
  ];
  const ladder = ladders.find((l) => l.key === badgeKey);
  return ladder?.rungs.find((rung) => rung.tier === tier)?.label ?? null;
}

// Financial career badges (dollar ledger + purchases — not box-score derived).
// Earner/Spender/Attribute/Dev-Upgrade are lifetime cumulative ladders, isolated per
// game type (a user's Madden earning/spending never combines with their CFB totals).
// Saver is a live balance check, not a cumulative ladder — see financial-badges.ts.
export const EARNER_RUNGS: LadderRung[] = [
  { value: 5000, tier: "bronze", label: "Money Man" },
  { value: 10000, tier: "silver", label: "Bank Roll" },
  { value: 30000, tier: "gold", label: "Big Bank" },
];
export const SPENDER_RUNGS: LadderRung[] = [
  { value: 5000, tier: "bronze", label: "Steady Shopper" },
  { value: 10000, tier: "silver", label: "Shopaholic" },
  { value: 30000, tier: "gold", label: "Pay to Play" },
];
export const SAVER_RUNGS: LadderRung[] = [
  { value: 5000, tier: "bronze", label: "Penny Pincher" },
  { value: 10000, tier: "silver", label: "Stiff Wallet" },
  { value: 30000, tier: "gold", label: "Heavy Hoarder" },
];
export const ATTRIBUTE_PURCHASE_RUNGS: LadderRung[] = [
  { value: 1000, tier: "bronze", label: "Quality Trainer" },
  { value: 2000, tier: "silver", label: "Heavy Investor" },
  { value: 5000, tier: "gold", label: "Build-a-Baller" },
];
export const DEV_UPGRADE_PURCHASE_RUNGS: LadderRung[] = [
  { value: 1000, tier: "bronze", label: "Cash for Comp" },
  { value: 2000, tier: "silver", label: "Fantastic Facilitator" },
  { value: 5000, tier: "gold", label: "Superstar Farm" },
];

// ─── Tiering ───────────────────────────────────────────────────────────────────

export type PositiveOccurrenceTier = "normal" | "bronze" | "silver" | "gold";
export type NegativeOccurrenceSeverity = "needs_work" | "warning" | "serious_problem" | "shit_show";

/**
 * Game-scope badge tier from this season's occurrence count.
 *   0        -> not earned (caller should not display this at all)
 *   1-3      -> normal / Needs Work
 *   4-6      -> bronze / Warning
 *   7-9      -> silver / Serious Problem
 *   10+      -> gold / Shit Show
 */
export function tierForOccurrenceCount(count: number, polarity: BadgePolarity): PositiveOccurrenceTier | NegativeOccurrenceSeverity {
  if (polarity === "negative") {
    if (count >= 10) return "shit_show";
    if (count >= 7) return "serious_problem";
    if (count >= 4) return "warning";
    return "needs_work";
  }
  if (count >= 10) return "gold";
  if (count >= 7) return "silver";
  if (count >= 4) return "bronze";
  return "normal";
}

/** Applies a badge's tierLabels override (positive game-scope badges whose name changes at higher tiers). */
export function displayLabelForTier(def: BadgeDef<unknown>, tier: string): string {
  const override = def.tierLabels?.[tier as "bronze" | "silver" | "gold"];
  return override ?? def.label;
}
