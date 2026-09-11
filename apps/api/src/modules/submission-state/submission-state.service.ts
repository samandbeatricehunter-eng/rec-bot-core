import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export async function getWeeklyPanel(guildId: string, seasonNumber: number, seasonStage: string, weekNumber: number | null) {
  const context = await getCurrentLeagueContext(guildId);
  let query = supabase.from("rec_weekly_submission_panels").select("discord_channel_id,discord_message_id").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("season_stage", seasonStage);
  query = weekNumber == null ? query.is("week_number", null) : query.eq("week_number", weekNumber);
  const result = await query.maybeSingle(); if (result.error) throw new ApiError(500, "Failed to load weekly panel state.", result.error);
  return { panel: result.data ?? null };
}

export async function saveWeeklyPanel(input: { guildId: string; seasonNumber: number; seasonStage: string; weekNumber: number | null; channelId: string; messageId: string }) {
  const context = await getCurrentLeagueContext(input.guildId); const now = new Date().toISOString();
  await supabase.from("rec_weekly_submission_panels").update({ is_active: false, updated_at: now }).eq("league_id", context.leagueId).eq("is_active", true);
  const result = await supabase.from("rec_weekly_submission_panels").upsert({ league_id: context.leagueId, season_number: input.seasonNumber, season_stage: input.seasonStage, week_number: input.weekNumber, discord_channel_id: input.channelId, discord_message_id: input.messageId, is_active: true, updated_at: now }, { onConflict: "league_id,season_number,season_stage,week_number" });
  if (result.error) throw new ApiError(500, "Failed to save weekly panel state.", result.error);
  return { saved: true };
}
