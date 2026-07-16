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

export const GAME_BADGES: BadgeDef<GameStats>[] = [
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

// ─── Season-scope badges — qualified from a season's cumulative totals ────────
// Always tier "normal". Reset every new season. "Reigning ___" badges are issued
// for the season AFTER the one they were won in — see issueReigningChampionBadges
// in persistence.ts, not qualifies() here (they need the PRIOR season's totals).

export const SEASON_BADGES: BadgeDef<SeasonTotals>[] = [
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

// ─── Career-scope badges — all-time cumulative per user per league (never reset) ──
// Simple boolean/threshold badges, always tier "normal" unless noted.

export const CAREER_BADGES: BadgeDef<CareerTotals>[] = [
  { key: "veteran_coach", label: "REC League Veteran", polarity: "positive", description: "100+ career games played", qualifies: (c) => c.gamesPlayed >= 100 },
  { key: "fourth_down_legend", label: "4th Down Legend", polarity: "positive", description: "200+ career fourth-down conversions", games: MADDEN_ONLY, qualifies: (c) => c.fourthDownConversions >= 200 },
  { key: "fourth_down_legend", label: "4th Down Legend", polarity: "positive", description: "100+ career fourth-down conversions at 80%+", games: CFB_27_ONLY, qualifies: (c) => c.fourthDownConversions >= 100 },
  { key: "red_zone_legend", label: "Red Zone Legend", polarity: "positive", description: "25+ games at 85%+ red zone efficiency and 25+ games holding opponents to 40% or less", qualifies: (c) => c.gamesRedZone75Plus >= 25 && c.gamesOppRedZone40OrLess >= 25 },
  { key: "ground_and_pound_veteran", label: "Run Game Veteran", polarity: "positive", description: "50+ career games with 150+ rushing yards", qualifies: (c) => c.games150PlusRush >= 50 },
  { key: "air_raid_veteran", label: "Pass Game Veteran", polarity: "positive", description: "50+ career games with 350+ passing yards", qualifies: (c) => c.games350PlusPass >= 50 },
  { key: "playoff_winner", label: "Playoff Winner", polarity: "positive", description: "50%+ career playoff win rate (min. 4 playoff games)", qualifies: (c) => c.playoffWins + c.playoffLosses >= 4 && c.playoffWins / (c.playoffWins + c.playoffLosses) >= 0.5 },
  { key: "dynasty_builder", label: "Dynasty Builder", polarity: "positive", description: "3+ career championships", qualifies: (c) => c.championships >= 3 },
];

/** Career-scope "ladder" badges — one badge, tier grades with the highest threshold crossed. */
export const CAREER_LADDER_BADGES: LadderBadgeDef[] = [
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
