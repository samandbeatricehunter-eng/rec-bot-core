import type { Guild, TextChannel } from "discord.js";

type ServerRoutes = {
  announcements_channel_id?: string | null;
  voting_polls_channel_id?: string | null;
};

export async function fetchRoutedTextChannel(guild: Guild, channelId?: string | null) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return null;
  return channel as TextChannel;
}

export async function getAnnouncementsChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.announcements_channel_id);
}

export async function getVotingPollsChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.voting_polls_channel_id);
}
