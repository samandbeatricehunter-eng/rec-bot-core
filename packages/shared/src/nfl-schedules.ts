import type { NflScheduleGame } from "./nfl-schedule-2025.js";
import { NFL_SCHEDULE_2025 } from "./nfl-schedule-2025.js";
import { NFL_SCHEDULE_2026 } from "./nfl-schedule-2026.js";

export type { NflScheduleGame };

export type MaddenLeagueGame = "madden_26" | "madden_27";

/** Real-world NFL season year used as the default matchup template for each Madden title. */
export const DEFAULT_NFL_SEASON_BY_GAME: Record<MaddenLeagueGame, number> = {
  madden_26: 2025,
  madden_27: 2026,
};

export const DEFAULT_NFL_SEASON_LABEL_BY_GAME: Record<MaddenLeagueGame, string> = {
  madden_26: "2025–2026",
  madden_27: "2026–2027",
};

export function getDefaultNflScheduleForGame(game: MaddenLeagueGame): NflScheduleGame[] {
  const season = DEFAULT_NFL_SEASON_BY_GAME[game];
  if (season === 2025) return NFL_SCHEDULE_2025;
  if (season === 2026) return NFL_SCHEDULE_2026;
  throw new Error(`No default NFL schedule is configured for ${game}.`);
}

export function getDefaultNflSeasonLabelForGame(game: MaddenLeagueGame): string {
  return DEFAULT_NFL_SEASON_LABEL_BY_GAME[game];
}
