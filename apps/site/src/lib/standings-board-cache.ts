import type { HubResponse } from "../types/api.js";

export type StandingsBoardResponse = {
  league: Pick<HubResponse["league"], "id" | "name" | "game" | "seasonNumber" | "weekNumber" | "seasonStage">;
  powerRankings: HubResponse["powerRankings"];
  sos: HubResponse["sos"];
};

const STANDINGS_BOARD_CACHE_PREFIX = "rec:standings-board:v1:";

// localStorage, not sessionStorage: this is public league-wide data (power rankings + SOS),
// identical for every viewer in the guild, that only actually changes after an import/advance --
// there's no correctness reason to force a cold refetch on every new tab/app launch. The read
// path always shows this instantly, then refetches in the background and overwrites it, so a
// stale entry is only ever visible for one paint.
export function readStandingsBoardCache(guildId: string): StandingsBoardResponse | null {
  try {
    const raw = localStorage.getItem(`${STANDINGS_BOARD_CACHE_PREFIX}${guildId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StandingsBoardResponse;
    if (!parsed?.league?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStandingsBoardCache(guildId: string, value: StandingsBoardResponse) {
  try {
    localStorage.setItem(`${STANDINGS_BOARD_CACHE_PREFIX}${guildId}`, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}
