import type { CreateLeagueInput } from "./setup.schemas.js";
import { createLeagueForServer as createBaseLeagueForServer } from "./setup.service.js";

// This used to unconditionally overwrite season_number/season_stage/current_week with
// input.seasonNumber/seasonStage/currentWeek right after creation. The League Setup wizard never
// actually populates those fields (LeagueSetupDraft has no such properties), so every league
// creation silently reset itself back to Zod's schema defaults (season_stage always
// "preseason_training_camp", even for a CFB league that should start at "preseason") a moment
// before the wizard's own authoritative setLeagueWeek() call ran to fix it back up — a landmine
// if that follow-up call ever failed. createBaseLeagueForServer already sets the correct
// game-aware starting season_stage at insert time, so this wrapper is now a pure passthrough.
export async function createLeagueForServer(input: CreateLeagueInput) {
  return createBaseLeagueForServer(input);
}
