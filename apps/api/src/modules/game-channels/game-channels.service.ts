import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export async function listTrackedGameChannelDiscordIds(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("discord_channel_id")
    .eq("league_id", context.leagueId)
    .in("status", ["active", "archived"]);
  if (error) throw new ApiError(500, "Failed to load tracked game channels.", error);
  return [...new Set((data ?? []).map((row) => row.discord_channel_id).filter(Boolean))];
}

export async function registerGameChannel(input: {
  guildId: string;
  gameId?: string | null;
  discordChannelId: string;
  seasonNumber: number;
  weekNumber: number;
  awayTeamId?: string | null;
  homeTeamId?: string | null;
  awayUserId?: string | null;
  homeUserId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();
  const payload = {
    league_id: context.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    game_id: input.gameId ?? null,
    discord_channel_id: input.discordChannelId,
    away_team_id: input.awayTeamId ?? null,
    home_team_id: input.homeTeamId ?? null,
    away_user_id: input.awayUserId ?? null,
    home_user_id: input.homeUserId ?? null,
    status: "active",
    updated_at: now,
  };

  const existing = await supabase
    .from("rec_game_channels")
    .select("id")
    .eq("discord_channel_id", input.discordChannelId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to look up existing game channel record.", existing.error);

  const result = existing.data?.id
    ? await supabase.from("rec_game_channels").update(payload).eq("id", existing.data.id).select("*").single()
    : await supabase.from("rec_game_channels").insert({ ...payload, created_at: now }).select("*").single();
  if (result.error) throw new ApiError(500, "Failed to register game channel.", result.error);
  return result.data;
}

export async function markTrackedGameChannelsDeleted(discordChannelIds: string[]) {
  if (!discordChannelIds.length) return { updated: 0 };
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_game_channels")
    .update({ status: "deleted", deleted_at: now, updated_at: now })
    .in("discord_channel_id", discordChannelIds)
    .in("status", ["active", "archived"])
    .select("id");
  if (result.error) throw new ApiError(500, "Failed to mark game channels deleted.", result.error);
  return { updated: result.data?.length ?? 0 };
}
