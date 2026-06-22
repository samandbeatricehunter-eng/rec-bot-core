import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

type SetLeagueWeekInput = {
  guildId: string;
  weekNumber: number;
  seasonStage: string;
  seasonNumber?: number;
};

export async function viewLeagueWeek(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  return {
    league: context.rec_leagues,
    server: context.rec_discord_servers
  };
}

export async function setLeagueWeek(input: SetLeagueWeekInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const previousWeek = Number(context.rec_leagues.current_week ?? 1);
  const previousStage = String(context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "regular_season");
  const highlightAwardsDue = previousWeek === 18 && previousStage === "regular_season" && input.weekNumber === 19 && input.seasonStage === "wild_card";
  const payload = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    ...(input.seasonNumber ? { season_number: input.seasonNumber } : {}),
    updated_at: new Date().toISOString()
  };

  const result = await supabase
    .from("rec_leagues")
    .update(payload)
    .eq("id", context.leagueId)
    .select("*")
    .single();

  if (result.error) throw new ApiError(500, "Failed to update league week.", result.error);

  return {
    league: result.data,
    highlightAwardsDue,
    warning: "Advance/import automation is currently being rebuilt; manual week changes do not run catch-up payouts or weekly automation."
  };
}
