import type { Guild, TextChannel } from "discord.js";
import { recApi } from "./rec-api.js";

type ServerRoutes = {
  announcements_channel_id?: string | null;
  headlines_channel_id?: string | null;
  power_rankings_channel_id?: string | null;
  voting_polls_channel_id?: string | null;
  box_scores_channel_id?: string | null;
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
  const channel = await fetchRoutedTextChannel(guild, routes.announcements_channel_id);
  if (!channel) return null;

  // Every bot post sent through the announcements route is mirrored into the Hub feed.
  // The DB write is deliberately non-fatal: Discord delivery should still succeed if the
  // web feed is temporarily unavailable.
  return new Proxy(channel, {
    get(target, property) {
      if (property === "send") {
        return async (payload: any) => {
          const message = await target.send(payload);
          const embed = typeof payload === "object" && Array.isArray(payload?.embeds) ? payload.embeds[0] : null;
          const embedJson = embed?.toJSON ? embed.toJSON() : embed?.data ?? embed ?? {};
          const title = String(embedJson?.title ?? "League Announcement");
          const body = String(embedJson?.description ?? (typeof payload === "string" ? payload : payload?.content ?? "League update")).replace(/^@everyone\s*/i, "").trim();
          void recApi.recordHubAnnouncement({ guildId: guild.id, title, body, discordChannelId: message.channelId, discordMessageId: message.id }).catch((error) => {
            console.error("[ERROR] Failed to mirror Discord announcement to League Hub (non-fatal):", error);
          });
          return message;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

export async function getBoxScoresChannel(guild: Guild, routes: ServerRoutes) {
  return fetchRoutedTextChannel(guild, routes.box_scores_channel_id);
}

/**
 * Deletes every message in a channel — used to reset the box scores channel at the start
 * of each new game week so old submissions/chatter don't linger. Discord's bulk-delete
 * only touches messages under 14 days old (rare for anything to be older in a
 * weekly-cadence channel, but `bulkDelete`'s filterOld flag skips them instead of
 * throwing); anything it skips is removed one at a time as a fallback.
 */
export async function purgeChannelMessages(channel: TextChannel) {
  let fetched;
  do {
    fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched || fetched.size === 0) break;
    const deleted = await channel.bulkDelete(fetched, true).catch(() => null);
    const remaining = deleted ? fetched.filter((message) => !deleted.has(message.id)) : fetched;
    for (const message of remaining.values()) {
      await message.delete().catch(() => undefined);
    }
  } while (fetched.size === 100);
}
