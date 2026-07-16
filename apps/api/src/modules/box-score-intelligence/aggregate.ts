// Pure rollups from a list of per-game GameStats. Season and career totals are
// RECOMPUTED from the stored games on every import (never incremented), which
// makes badge progress idempotent and re-import-safe.

import { qualifyGameBadges } from "./badge-rules.js";
import { type CareerTotals, type GameStats, type SeasonTotals, returnYards } from "./types.js";

const avg = (nums: number[]): number => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0);

/** Aggregate one season's games for a single user/team into SeasonTotals. */
export function seasonTotalsFromGames(games: GameStats[]): SeasonTotals {
  const reg = games.filter((g) => !g.isPlayoff);
  const topGames = games.filter((g) => g.timeOfPossessionSeconds != null);
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
    wonChampionship: games.some((g) => g.isSuperBowl && g.won),
    wonConferenceChampionship: games.some((g) => g.isConferenceChampionshipGame && g.won),
    wonDivisionalRound: games.some((g) => g.isDivisionalRound && g.won),
    wonAnyBowlGame: games.some((g) => g.isPlayoff && g.won),
    timeOfPossessionAvgSeconds: topGames.length ? avg(topGames.map((g) => g.timeOfPossessionSeconds!)) : null,
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
    fourthDownConversions: sum(games, (g) => g.fourthDownConversions),
    gamesRedZone75Plus: count((g) => g.redZoneOffensivePct >= 75),
    gamesOppRedZone40OrLess: count((g) => g.opponentRedZoneOffensivePct <= 40),
    games150PlusRush: count((g) => g.rushingYards >= 150),
    games350PlusPass: count((g) => g.passingYards >= 350),
    playoffWins: count((g) => g.isPlayoff && g.won),
    playoffLosses: count((g) => g.isPlayoff && g.lost),
    championships: count((g) => g.isSuperBowl && g.won),
  };
}

export interface GameBadgeOccurrence {
  badgeKey: string;
  /** How many games this season qualified for this badge (no streak concept anymore). */
  earnedCount: number;
  lastEarnedWeek: number | null;
}

/** Per-game-badge occurrence counts for one user's season — no streaks, just a tally. */
export function gameBadgeOccurrences(seasonGames: GameStats[], game?: string | null): GameBadgeOccurrence[] {
  const ordered = [...seasonGames].sort((a, b) => a.week - b.week);
  const tally = new Map<string, GameBadgeOccurrence>();
  for (const g of ordered) {
    if (g.statsQuarantined) continue; // untrustworthy OCR data never counts toward a badge
    for (const badge of qualifyGameBadges(g, game)) {
      const entry = tally.get(badge.key) ?? { badgeKey: badge.key, earnedCount: 0, lastEarnedWeek: null };
      entry.earnedCount += 1;
      entry.lastEarnedWeek = g.week;
      tally.set(badge.key, entry);
    }
  }
  return [...tally.values()];
}

function sum(games: GameStats[], pick: (g: GameStats) => number): number {
  return games.reduce((s, g) => s + (pick(g) || 0), 0);
}
