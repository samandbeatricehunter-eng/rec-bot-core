// Pure rollups from a list of per-game GameStats. Season and career totals are
// RECOMPUTED from the stored games on every import (never incremented), which
// makes badge progress idempotent and re-import-safe. Streaks are derived by
// walking a user's weekly games in order.

import { qualifyWeeklyBadges } from "./badge-rules.js";
import { type CareerTotals, type GameStats, type SeasonTotals, returnYards } from "./types.js";

const avg = (nums: number[]): number => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0);

/** Aggregate one season's games for a single user/team into SeasonTotals. */
export function seasonTotalsFromGames(games: GameStats[]): SeasonTotals {
  const reg = games.filter((g) => !g.isPlayoff);
  return {
    wins: games.filter((g) => g.won).length,
    losses: games.filter((g) => g.lost).length,
    ties: games.filter((g) => g.tied).length,
    gamesPlayed: games.length,
    regularSeasonGames: reg.length,
    regularSeasonLosses: reg.filter((g) => g.lost).length,
    passingYards: sum(games, (g) => g.passingYards),
    rushingYards: sum(games, (g) => g.rushingYards),
    firstDowns: sum(games, (g) => g.firstDowns),
    thirdDownConversions: sum(games, (g) => g.thirdDownConversions),
    fourthDownConversions: sum(games, (g) => g.fourthDownConversions),
    twoPointConversions: sum(games, (g) => g.twoPointConversions),
    turnoversCommitted: sum(games, (g) => g.turnoversCommitted),
    opponentTurnovers: sum(games, (g) => g.opponentTurnovers),
    returnYards: sum(games, (g) => returnYards(g)),
    pointsFor: sum(games, (g) => g.pointsFor),
    pointsAgainst: sum(games, (g) => g.pointsAgainst),
    seasonRedZoneOffPct: Math.round(avg(games.map((g) => g.redZoneOffensivePct))),
    opponentSeasonRedZoneOffPct: Math.round(avg(games.map((g) => g.opponentRedZoneOffensivePct))),
    // Not derivable from a single user's games alone — division standings need every
    // team's record. issueSeasonTotalBadges (persistence.ts) overrides this with a
    // real league-wide computation for Madden leagues; CFB has no division structure.
    wonDivision: false,
    wonChampionship: games.some((g) => g.isSuperBowl && g.won),
  };
}

/** Aggregate all of a user's games (any season) into CareerTotals. */
export function careerTotalsFromGames(games: GameStats[]): CareerTotals {
  const count = (pred: (g: GameStats) => boolean) => games.filter(pred).length;
  return {
    wins: count((g) => g.won),
    gamesPlayed: games.length,
    seasonsCompleted: new Set(games.map((g) => g.season)).size,
    passingYards: sum(games, (g) => g.passingYards),
    rushingYards: sum(games, (g) => g.rushingYards),
    firstDowns: sum(games, (g) => g.firstDowns),
    thirdDownConversions: sum(games, (g) => g.thirdDownConversions),
    fourthDownConversions: sum(games, (g) => g.fourthDownConversions),
    gamesRedZone75: count((g) => g.redZoneOffensivePct >= 75),
    gamesOppRedZone40OrLess: count((g) => g.opponentRedZoneOffensivePct <= 40),
    turnoverFreeGames: count((g) => g.turnoversCommitted === 0),
    winsWith3PlusTurnovers: count((g) => g.won && g.turnoversCommitted >= 3),
    winsOpp3PlusTurnovers: count((g) => g.won && g.opponentTurnovers >= 3),
    winsScoring38Plus: count((g) => g.won && g.pointsFor >= 38),
    games200PlusRush: count((g) => g.rushingYards >= 200),
    games375PlusPass: count((g) => g.passingYards >= 375),
    gamesBalanced: count((g) => g.passingYards >= 225 && g.rushingYards >= 125),
    gamesNickelDime: count((g) => g.firstDowns >= 24 && g.thirdDownConversions >= 8),
    bendDontBreakWins: count((g) => g.won && g.margin <= 7 && g.opponentFirstDowns >= 22 && g.opponentThirdDownConversions >= 7),
    homeWins: count((g) => g.homeAway === "home" && g.won),
    roadWins: count((g) => g.homeAway === "away" && g.won),
    playoffWins: count((g) => g.isPlayoff && g.won),
    superBowlTitles: count((g) => g.isSuperBowl && g.won),
  };
}

export interface WeeklyStreak {
  badgeKey: string;
  earnedCount: number; // total weeks earned this season (not necessarily consecutive)
  currentStreak: number; // uninterrupted consecutive earns ending at the latest game
  bestStreak: number;
  lastEarnedWeek: number | null;
}

/**
 * Per-weekly-badge streaks for one user's season, walking games in week order.
 * `currentStreak` is the consecutive run that includes the most recent game.
 */
export function weeklyStreaks(seasonGames: GameStats[], game?: string | null): WeeklyStreak[] {
  const ordered = [...seasonGames].sort((a, b) => a.week - b.week);
  const out: WeeklyStreak[] = [];
  const earnedByGame = ordered.map((g) => new Set(qualifyWeeklyBadges(g, game).map((b) => b.key)));

  // Collect every key earned at least once.
  const allKeys = new Set<string>();
  for (const s of earnedByGame) for (const k of s) allKeys.add(k);

  for (const key of allKeys) {
    let earnedCount = 0;
    let run = 0;
    let best = 0;
    let lastWeek: number | null = null;
    for (let i = 0; i < ordered.length; i++) {
      if (earnedByGame[i].has(key)) {
        earnedCount++;
        run++;
        best = Math.max(best, run);
        lastWeek = ordered[i].week;
      } else {
        run = 0;
      }
    }
    // run now reflects the trailing consecutive streak (0 if the latest game missed it).
    out.push({ badgeKey: key, earnedCount, currentStreak: run, bestStreak: best, lastEarnedWeek: lastWeek });
  }
  return out;
}

function sum(games: GameStats[], pick: (g: GameStats) => number): number {
  return games.reduce((s, g) => s + (pick(g) || 0), 0);
}
