import type { HubResponse } from "../types/api.js";

export type StandingsBoardResponse = {
  league: Pick<HubResponse["league"], "id" | "name" | "game" | "seasonNumber" | "weekNumber" | "seasonStage">;
  powerRankings: HubResponse["powerRankings"];
  sos: HubResponse["sos"];
};

const STANDINGS_BOARD_CACHE_PREFIX = "rec:standings-board:v1:";

export function readStandingsBoardCache(guildId: string): StandingsBoardResponse | null {
  try {
    const raw = sessionStorage.getItem(`${STANDINGS_BOARD_CACHE_PREFIX}${guildId}`);
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
    sessionStorage.setItem(`${STANDINGS_BOARD_CACHE_PREFIX}${guildId}`, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}
