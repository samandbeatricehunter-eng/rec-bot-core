// Typed accessor over config/weekly_challenge_catalog.json -- same JSON-config pattern as
// packages/shared/src/immortality/config.ts. See build_weekly_challenges.js (run once, not
// committed) for how this file was distilled from the uploaded package's 200-entry catalog down
// to the 148 entries (70 offense, 68 defense, 10 special-teams) whose bronze/silver/gold
// requirements fully translate to structured conditions gradable from real REC data.
import weeklyChallengeCatalogJson from "./config/weekly_challenge_catalog.json" with { type: "json" };
import type { WeeklyChallengeEntry, WeeklyChallengeSide } from "./conditions.js";

const CATALOG = weeklyChallengeCatalogJson as unknown as WeeklyChallengeEntry[];

export function weeklyChallengeCatalog(side?: WeeklyChallengeSide): WeeklyChallengeEntry[] {
  return side ? CATALOG.filter((entry) => entry.side === side) : CATALOG;
}

export function weeklyChallengeById(id: string): WeeklyChallengeEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

function pickIndex(seed: string, length: number, salt: number): number {
  let hash = salt >>> 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

/** Deterministic pick for a (team, week, side) so repeated grading passes within the same week
 * always resolve the same catalog entry -- same seeding technique RTI's issuedWeeklyChallenges
 * uses (packages/shared/src/immortality/challenges.ts). */
export function pickWeeklyChallenge(side: WeeklyChallengeSide, seed: string): WeeklyChallengeEntry | undefined {
  const pool = weeklyChallengeCatalog(side);
  if (!pool.length) return undefined;
  return pool[pickIndex(seed, pool.length, side === "offense" ? 1 : side === "defense" ? 2 : 3)];
}
