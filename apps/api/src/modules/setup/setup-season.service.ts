import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import type { CreateLeagueInput } from "./setup.schemas.js";
import { createLeagueForServer as createBaseLeagueForServer } from "./setup.service.js";

export async function createLeagueForServer(input: CreateLeagueInput) {
  const result = await createBaseLeagueForServer(input);

  const updatedLeague = await supabase
    .from("rec_leagues")
    .update({
      season_number: input.seasonNumber,
      season_stage: input.seasonStage,
      current_week: input.currentWeek
    })
    .eq("id", result.league.id)
    .select("*")
    .single();

  if (updatedLeague.error) {
    throw new ApiError(500, "Failed to persist league season state", updatedLeague.error);
  }

  return {
    ...result,
    league: updatedLeague.data
  };
}
