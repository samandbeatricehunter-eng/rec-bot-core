import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createGuildChannel } from "../../lib/discord-guild.js";
import { getAdvanceWeekGames } from "../league-week/advance-results.service.js";

export async function getGameChannelByDiscordId(discordChannelId: string) {
  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("*")
    .eq("discord_channel_id", discordChannelId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load game channel matchup record.", error);
  return data ?? null;
}

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

function channelSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
}

export async function createCurrentWeekGameChannels(guildId: string) {
  const [context, week] = await Promise.all([getCurrentLeagueContext(guildId), getAdvanceWeekGames(guildId)]);
  const categoryId = String((context.routes as any)?.game_channels_category_id ?? "");
  if (!categoryId) throw new ApiError(400, "Assign the Game Channels category in Settings before creating game channels.");
  const h2hGames = week.games.filter((game) => game.isH2h);
  const gameIds = h2hGames.map((game) => game.gameId);
  const existing = gameIds.length
    ? await supabase.from("rec_game_channels").select("game_id,discord_channel_id").eq("league_id", context.leagueId).in("game_id", gameIds).in("status", ["active", "archived"])
    : { data: [], error: null };
  if (existing.error) throw new ApiError(500, "Failed to check existing game channels.", existing.error);
  const existingByGame = new Map((existing.data ?? []).map((row) => [String(row.game_id), String(row.discord_channel_id)]));
  const created: Array<{ gameId: string; discordChannelId: string; name: string }> = [];
  for (const game of h2hGames) {
    if (existingByGame.has(game.gameId)) continue;
    const name = `wk-${week.currentWeek}-${channelSlug(game.awayTeamName)}-at-${channelSlug(game.homeTeamName)}`.slice(0, 100);
    const channel = await createGuildChannel(guildId, { name, type: "text", parentChannelId: categoryId });
    await registerGameChannel({ guildId, gameId: game.gameId, discordChannelId: channel.id, seasonNumber: week.seasonNumber, weekNumber: week.currentWeek, awayTeamId: game.awayTeamId, homeTeamId: game.homeTeamId, awayUserId: game.awayUserId, homeUserId: game.homeUserId });
    created.push({ gameId: game.gameId, discordChannelId: channel.id, name: channel.name });
  }
  return { created, existing: existingByGame.size, eligible: h2hGames.length };
}
