import type { Guild, TextChannel } from "discord.js";
import { recApi } from "./rec-api.js";

type ServerRoutes = {
  announcements_channel_id?: string | null;
  headlines_channel_id?: string | null;
  power_rankings_channel_id?: string | null;
  voting_polls_channel_id?: string | null;
};

export async function getRouteChannels(guildId: string): Promise<Record<string, any>> {
  const cfg = await recApi.getEconomyConfig(guildId).catch(() => null);
  return cfg?.routes ?? {};
}

export async function fetchRoutedTextChannel(guild: Guild, channelId?: string | null) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return null;
  return channel as TextChannel;
}

export async function getAnnouncementsChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.announcements_channel_id);
}

export async function getHeadlinesChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.headlines_channel_id);
}

export async function getPowerRankingsChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.power_rankings_channel_id);
}

export async function getVotingPollsChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.voting_polls_channel_id);
}
