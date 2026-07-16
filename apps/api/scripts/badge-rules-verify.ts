// Unit checks for the box-score intelligence engine (badges + occurrence tiering + stories).
//
//   pnpm --filter @rec/api exec tsx scripts/badge-rules-verify.ts
//
// Pure logic, no DB — runs in milliseconds. Exits non-zero on any failed check.
import {
  GAME_BADGES,
  SEASON_BADGES,
  CAREER_BADGES,
  CAREER_LADDER_BADGES,
  qualifyGameBadges,
  qualifySeasonBadges,
  qualifyCareerBadges,
  qualifyLadderBadges,
  tierForOccurrenceCount,
  generateGameStory,
  rowToGameStats,
  seasonTotalsFromGames,
  careerTotalsFromGames,
  gameBadgeOccurrences,
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
  isPlayoff: false, isSuperBowl: false, isConferenceChampionshipGame: false, isDivisionalRound: false,
  yardsAllowed: 300, statsQuarantined: false,
  passingYards: 200, rushingYards: 100, offensiveYards: 300, totalYards: 300, firstDowns: 18,
  thirdDownConversions: 5, fourthDownConversions: 0, twoPointConversions: 0, turnoversCommitted: 1,
  redZoneOffensivePct: 50, kickReturnYards: 0, puntReturnYards: 0,
  opponentFirstDowns: 15, opponentThirdDownConversions: 4, opponentThirdDownAttempts: null,
  opponentFourthDownConversions: 0, opponentFourthDownAttempts: null, opponentTurnovers: 0, opponentRedZoneOffensivePct: 50,
  totalPlays: null, yardsPerPlay: null, rushAttempts: null, rushTDs: null, yardsPerRush: null,
  passCompletions: null, passAttempts: null, passTDs: null, yardsPerPass: null,
  thirdDownAttempts: null, fourthDownAttempts: null, interceptionsThrown: null, fumblesLost: null,
  redZoneTDs: null, redZoneFGs: null, punts: null, puntAvgYards: null, penalties: null, penaltyYards: null,
  timeOfPossessionSeconds: null,
};
const g = (over: Partial<GameStats>): GameStats => ({ ...base, ...over });
const wonGame = (gs: GameStats, key: string, game: string | null = "madden_26") => qualifyGameBadges(gs, game).some((b) => b.key === key);

// ── Set sizes / uniqueness (positive game badges: shared 22 + Madden-only 10 + CFB-only 16) ──
check("no duplicate (key,games) game badge pairs", (() => {
  const seen = new Set<string>();
  for (const b of GAME_BADGES) {
    const bucket = b.games?.join(",") ?? "shared";
    const k = `${b.key}:${bucket}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
})());

// ── Game badge thresholds (boundary on/off) ──────────────────────────────────────
check("big_play_energy @450", wonGame(g({ offensiveYards: 450 }), "big_play_energy"));
check("nickel_and_dime", wonGame(g({ firstDowns: 18, thirdDownConversions: 6 }), "nickel_and_dime"));
check("chain_mover (Madden) @20 FD", wonGame(g({ firstDowns: 20 }), "chain_mover", "madden_26"));
check("chain_mover (CFB) needs 80% on attempts", wonGame(g({ firstDowns: 18, thirdDownConversions: 8, thirdDownAttempts: 10 }), "chain_mover", "cfb_27"));
check("chain_mover (CFB) fails under 80%", !wonGame(g({ firstDowns: 18, thirdDownConversions: 7, thirdDownAttempts: 10 }), "chain_mover", "cfb_27"));
check("perfect_red_zone @100", wonGame(g({ redZoneOffensivePct: 100 }), "perfect_red_zone"));
check("red_zone_efficient excludes 100", !wonGame(g({ redZoneOffensivePct: 100 }), "red_zone_efficient"));
check("red_zone_wall opp<=40", wonGame(g({ opponentRedZoneOffensivePct: 40 }), "red_zone_wall"));
check("ball_security @0 TO", wonGame(g({ turnoversCommitted: 0 }), "ball_security"));
check("opportunistic", wonGame(g({ won: true, opponentTurnovers: 3 }), "opportunistic"));
check("bend_dont_break (new thresholds)", wonGame(g({ won: true, margin: 6, opponentFirstDowns: 18, opponentThirdDownConversions: 6 }), "bend_dont_break"));
check("run_heavy (CFB) attempt-count based", wonGame(g({ rushAttempts: 30, passAttempts: 24 }), "run_heavy", "cfb_27"));
check("run_heavy (Madden) yardage based", wonGame(g({ rushingYards: 175, passingYards: 100 }), "run_heavy", "madden_26"));

// ── Negative game badges ─────────────────────────────────────────────────────────
check("turnover_trouble (Madden)", wonGame(g({ turnoversCommitted: 3 }), "turnover_trouble", "madden_26"));
check("yardage_flood Madden-only 450+ allowed", wonGame(g({ yardsAllowed: 450 }), "yardage_flood", "madden_26"));
check("yardage_flood not on CFB", !wonGame(g({ yardsAllowed: 450 }), "yardage_flood", "cfb_27"));
check("pick_parade CFB-only", wonGame(g({ interceptionsThrown: 3 }), "pick_parade", "cfb_27"));
check("completion_crisis needs 20+ attempts", wonGame(g({ passAttempts: 20, passCompletions: 9 }), "completion_crisis", "cfb_27"));
check("completion_crisis floor blocks 1-for-1", !wonGame(g({ passAttempts: 1, passCompletions: 0 }), "completion_crisis", "cfb_27"));
check("blowout_victim (CFB) needs 28+", wonGame(g({ lost: true, won: false, margin: -28 }), "blowout_victim", "cfb_27"));
check("blowout_victim (Madden) needs 22+", wonGame(g({ lost: true, won: false, margin: -22 }), "blowout_victim_m", "madden_26"));

// ── Occurrence tiering ───────────────────────────────────────────────────────────
check("occurrence 1 -> normal", tierForOccurrenceCount(1, "positive") === "normal");
check("occurrence 3 -> normal", tierForOccurrenceCount(3, "positive") === "normal");
check("occurrence 4 -> bronze", tierForOccurrenceCount(4, "positive") === "bronze");
check("occurrence 6 -> bronze", tierForOccurrenceCount(6, "positive") === "bronze");
check("occurrence 7 -> silver", tierForOccurrenceCount(7, "positive") === "silver");
check("occurrence 10 -> gold", tierForOccurrenceCount(10, "positive") === "gold");
check("negative occurrence 1 -> needs_work", tierForOccurrenceCount(1, "negative") === "needs_work");
check("negative occurrence 4 -> warning", tierForOccurrenceCount(4, "negative") === "warning");
check("negative occurrence 7 -> serious_problem", tierForOccurrenceCount(7, "negative") === "serious_problem");
check("negative occurrence 10 -> shit_show", tierForOccurrenceCount(10, "negative") === "shit_show");

// ── gameBadgeOccurrences (no streak concept — plain tally, quarantine skipped) ───
const wk = (week: number, over: Partial<GameStats>): GameStats => ({ ...base, week, ...over });
const seasonGames: GameStats[] = [
  wk(1, { rushingYards: 210 }), // ground_and_pound doesn't exist anymore; use ball_security instead
  wk(2, { turnoversCommitted: 0 }),
  wk(3, { turnoversCommitted: 0 }),
  wk(4, { turnoversCommitted: 0, statsQuarantined: true }), // must NOT count
  wk(5, { turnoversCommitted: 0 }),
];
const occ = gameBadgeOccurrences(seasonGames, "madden_26");
const ballSecurityOcc = occ.find((o) => o.badgeKey === "ball_security");
check("quarantined game excluded from occurrence count", ballSecurityOcc?.earnedCount === 3);

// ── Season badges ────────────────────────────────────────────────────────────────
const sBase: SeasonTotals = {
  wins: 8, losses: 9, ties: 0, gamesPlayed: 17, regularSeasonGames: 17, regularSeasonLosses: 9,
  passingYards: 3000, rushingYards: 1200, firstDowns: 300, thirdDownConversions: 90,
  fourthDownConversions: 10, twoPointConversions: 3, turnoversCommitted: 20, opponentTurnovers: 18,
  returnYards: 1000, pointsFor: 400, pointsAgainst: 380, seasonRedZoneOffPct: 60,
  opponentSeasonRedZoneOffPct: 60, wonChampionship: false, wonConferenceChampionship: false,
  wonDivisionalRound: false, wonAnyBowlGame: false, timeOfPossessionAvgSeconds: null,
};
const s = (over: Partial<SeasonTotals>) => ({ ...sBase, ...over });
const wonSeason = (st: SeasonTotals, key: string, game: string | null = "madden_26") => qualifySeasonBadges(st, game).some((b) => b.key === key);
check("prolific_passer (Madden) @5000", wonSeason(s({ passingYards: 5000 }), "prolific_passer", "madden_26"));
check("prolific_passer (CFB) @4000", wonSeason(s({ passingYards: 4000 }), "prolific_passer", "cfb_27"));
check("perfect_regular_season", wonSeason(s({ regularSeasonLosses: 0 }), "perfect_regular_season"));
check("winning_season Madden-only >8", wonSeason(s({ wins: 9 }), "winning_season", "madden_26"));
check("clock_bleeder CFB-only", wonSeason(s({ timeOfPossessionAvgSeconds: 18 * 60 }), "clock_bleeder", "cfb_27"));

// ── Career badges + ladders ──────────────────────────────────────────────────────
const cBase: CareerTotals = {
  wins: 0, gamesPlayed: 0, seasonsCompleted: 0, passingYards: 0, rushingYards: 0, firstDowns: 0,
  fourthDownConversions: 0, gamesRedZone75Plus: 0, gamesOppRedZone40OrLess: 0,
  games150PlusRush: 0, games350PlusPass: 0, playoffWins: 0, playoffLosses: 0, championships: 0,
};
const c = (over: Partial<CareerTotals>) => ({ ...cBase, ...over });
const wonCareer = (ct: CareerTotals, key: string) => qualifyCareerBadges(ct).some((b) => b.key === key);
check("veteran_coach @100 games", wonCareer(c({ gamesPlayed: 100 }), "veteran_coach"));
check("dynasty_builder @3 titles", wonCareer(c({ championships: 3 }), "dynasty_builder"));
check("playoff_winner needs min 4 playoff games", !wonCareer(c({ playoffWins: 1, playoffLosses: 0 }), "playoff_winner"));
check("playoff_winner @50%+ with min games", wonCareer(c({ playoffWins: 2, playoffLosses: 2 }), "playoff_winner"));

const ladderLow = qualifyLadderBadges(c({ wins: 50 }));
const ladderHigh = qualifyLadderBadges(c({ wins: 1000 }));
check("wins ladder @50 -> bronze", ladderLow.find((l) => l.key === "wins_milestone")?.tier === "bronze");
check("wins ladder @1000 -> gold", ladderHigh.find((l) => l.key === "wins_milestone")?.tier === "gold");
check("wins ladder count matches badge defs count", CAREER_LADDER_BADGES.length === 4);

// ── Story angle selection (unchanged engine, still fed by GameStats) ─────────────
const winner = g({ won: true, rushingYards: 230, pointsFor: 34, pointsAgainst: 10, margin: 24 });
const loser = g({ won: false, lost: true, homeAway: "away", pointsFor: 10, pointsAgainst: 34, margin: -24, turnoversCommitted: 1 });
const story1 = generateGameStory({ winner, loser, winnerName: "Cowboys", loserName: "Lions" }, ["Big Play Energy"]);
check("story: ground-heavy win -> ground_control", story1.primaryAngle === "ground_control");
check("story headline names teams", story1.headline.includes("Cowboys") && story1.headline.includes("Lions"));

// ── Row -> GameStats mapper (made-attempts extraction + sanity clamping) ─────────
const row: TeamGameStatsRow = {
  league_id: "L", season_number: 2, week_number: 5, game_id: "g1", team_id: "t1", user_id: "u1", opponent_team_id: "o1",
  is_home: false, result: "win", points_for: 31, points_against: 20,
  off_pass_yards: 280, off_rush_yards: 140, off_yards_gained: 420, total_yards_gained: 455, off_first_down: 26,
  turnovers_committed: 0, red_zone_off_percentage: 80, kick_return_yards: 90, punt_return_yards: 70,
  generated_turnovers: 2, yards_allowed: 310, first_downs_allowed: 18, red_zone_def_percentage: 65,
  offensive_stats: { third_down_conversions: "9-12", fourth_down_conversions: "1-1", two_point_conversions: "0" },
  defensive_stats: { third_down_conversions: "5-11" },
};
const mapped = rowToGameStats(row, "cfb_27");
check("map: thirdDown made from made-attempts string", mapped.thirdDownConversions === 9);
check("map: thirdDown attempts recovered (CFB)", mapped.thirdDownAttempts === 12);
check("map: opp third from defensive JSONB", mapped.opponentThirdDownConversions === 5);
check("map: opp red zone from def% (100-65)", mapped.opponentRedZoneOffensivePct === 35);
check("map: away + win", mapped.homeAway === "away" && mapped.won);
check("map: margin", mapped.margin === 11);

const badRow: TeamGameStatsRow = { ...row, turnovers_committed: 400 };
const badMapped = rowToGameStats(badRow, "madden_26");
check("sanity: turnovers=400 flags quarantine", badMapped.statsQuarantined === true);

const goodRow: TeamGameStatsRow = { ...row, turnovers_committed: 2 };
const goodMapped = rowToGameStats(goodRow, "madden_26");
check("sanity: turnovers=2 does not flag quarantine", goodMapped.statsQuarantined === false);

// ── Aggregation: season / career totals ──────────────────────────────────────────
const aggGames: GameStats[] = [
  wk(1, { won: true, lost: false, rushingYards: 210, passingYards: 150, pointsFor: 30, pointsAgainst: 10, turnoversCommitted: 0 }),
  wk(2, { won: true, lost: false, rushingYards: 220, passingYards: 140, pointsFor: 24, pointsAgainst: 14, turnoversCommitted: 0 }),
  wk(3, { won: false, lost: true, rushingYards: 80, passingYards: 300, pointsFor: 17, pointsAgainst: 28, turnoversCommitted: 2 }),
  wk(4, { won: true, lost: false, rushingYards: 205, passingYards: 120, pointsFor: 31, pointsAgainst: 20, turnoversCommitted: 1 }),
];
const st = seasonTotalsFromGames(aggGames);
check("season totals: wins", st.wins === 3);
check("season totals: losses", st.losses === 1);
check("season totals: rushing sum", st.rushingYards === 210 + 220 + 80 + 205);
check("season totals: games", st.gamesPlayed === 4);

const ct = careerTotalsFromGames(aggGames);
check("career: games150PlusRush = 3", ct.games150PlusRush === 3);
check("career: wins = 3", ct.wins === 3);

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
