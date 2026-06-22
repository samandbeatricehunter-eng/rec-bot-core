import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { applyAdvanceSavingsInterest } from "./advance-interest.service.js";

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

  const seasonNumber = Number(input.seasonNumber ?? result.data.season_number ?? result.data.display_season_number ?? 1);
  const savingsInterest = await applyAdvanceSavingsInterest({
    leagueId: context.leagueId,
    serverId: context.rec_discord_servers.id,
    seasonNumber,
    previousWeek,
    previousStage,
    nextWeek: input.weekNumber,
    nextStage: input.seasonStage,
    leagueRow: {
      interest_disabled_until: context.rec_leagues.interest_disabled_until ?? null,
      advance_rate_window_start: context.rec_leagues.advance_rate_window_start ?? null,
      advance_rate_count: context.rec_leagues.advance_rate_count ?? 0,
    },
  }).catch((error) => {
    console.error("[ERROR] Failed to apply savings interest on advance:", error);
    return { applied: false as const, reason: "error" as const, usersCredited: 0, totalInterest: 0 };
  });

  return {
    league: result.data,
    highlightAwardsDue,
    savingsInterest,
    warning: savingsInterest.applied && savingsInterest.usersCredited > 0
      ? undefined
      : "Advance week updated. Savings interest applies only on forward advances for linked users with savings.",
  };
}
