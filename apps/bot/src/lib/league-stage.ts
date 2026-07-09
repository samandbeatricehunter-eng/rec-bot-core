// Thin re-export — the game-aware season-stage machine lives in @rec/shared so the
// bot and the API never drift out of sync.
export { nextLeagueStage, stageHasScheduledGames, stageLabel, regularSeasonWeeks, maxSeasonWeek, stageForWeek, isCfb, isRegularSeasonWeek, isEosPayoutEligibleStage, gameplaySeasonStages, postseasonPayoutStages, type LeagueGame } from "@rec/shared";
