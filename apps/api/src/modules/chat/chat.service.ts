// Thin composition layer over league-chat, game-chat, and commissioner-chat — does not
// duplicate their send/list logic. Adds the one thing none of them track today: per-user
// unread state, via rec_chat_read_state, so the Universal Chat Drawer can show one badge
// across all three chat surfaces without each surface reinventing read tracking.
import type { ChatChannelSummary, ChatChannelType } from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { resolveChatAuthor } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { listGameChatChannels } from "../game-chat/game-chat.service.js";

type ChannelAggregate = { unreadCount: number; lastMessageAt: string | null; lastBody: string | null };

async function requireLinkedUserId(discordId: string): Promise<string> {
  const author = await resolveChatAuthor(discordId);
  if (!author.userId) throw new ApiError(400, "Chat requires a linked account.");
  return author.userId;
}

async function loadLeagueAggregate(userId: string, leagueId: string): Promise<ChannelAggregate> {
  const { rows } = await getPgPool().query(
    `
      select
        count(m.id) filter (where r.last_read_at is null or m.created_at > r.last_read_at)::int as unread_count,
        max(m.created_at) as last_message_at,
        (array_agg(m.body order by m.created_at desc))[1] as last_body
      from rec_league_chat_messages m
      left join rec_chat_read_state r
        on r.user_id = $1 and r.channel_type = 'league' and r.channel_id = $2::text
      where m.league_id = $2
    `,
    [userId, leagueId],
  );
  const row = rows[0] as { unread_count: number; last_message_at: string | Date | null; last_body: string | null } | undefined;
  return {
    unreadCount: row?.unread_count ?? 0,
    lastMessageAt: row?.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    lastBody: row?.last_body ?? null,
  };
}

async function loadGameAggregates(userId: string, gameChannelIds: string[]): Promise<Map<string, ChannelAggregate>> {
  const aggregates = new Map<string, ChannelAggregate>();
  if (!gameChannelIds.length) return aggregates;
  const { rows } = await getPgPool().query(
    `
      select
        m.game_channel_id,
        count(m.id) filter (where r.last_read_at is null or m.created_at > r.last_read_at)::int as unread_count,
        max(m.created_at) as last_message_at,
        (array_agg(m.body order by m.created_at desc))[1] as last_body
      from rec_game_chat_messages m
      left join rec_chat_read_state r
        on r.user_id = $1 and r.channel_type = 'game' and r.channel_id = m.game_channel_id::text
      where m.game_channel_id = any($2::uuid[])
      group by m.game_channel_id
    `,
    [userId, gameChannelIds],
  );
  for (const row of rows as Array<{ game_channel_id: string; unread_count: number; last_message_at: string | Date | null; last_body: string | null }>) {
    aggregates.set(row.game_channel_id, {
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
      lastBody: row.last_body,
    });
  }
  return aggregates;
}

async function loadGameParticipants(gameChannelIds: string[]): Promise<Map<string, { away: string | null; home: string | null }>> {
  const participants = new Map<string, { away: string | null; home: string | null }>();
  if (!gameChannelIds.length) return participants;
  const { rows } = await getPgPool().query(
    `select id, away_user_id, home_user_id from rec_game_channels where id = any($1::uuid[])`,
    [gameChannelIds],
  );
  for (const row of rows as Array<{ id: string; away_user_id: string | null; home_user_id: string | null }>) {
    participants.set(row.id, { away: row.away_user_id, home: row.home_user_id });
  }
  return participants;
}

async function loadCommissionerAggregate(userId: string, guildId: string): Promise<ChannelAggregate> {
  const { rows } = await getPgPool().query(
    `
      select
        count(m.id) filter (where r.last_read_at is null or m.created_at > r.last_read_at)::int as unread_count,
        max(m.created_at) as last_message_at,
        (array_agg(m.body order by m.created_at desc))[1] as last_body
      from rec_commissioner_chat_messages m
      left join rec_chat_read_state r
        on r.user_id = $1 and r.channel_type = 'commissioner' and r.channel_id = $2
      where m.guild_id = $2
    `,
    [userId, guildId],
  );
  const row = rows[0] as { unread_count: number; last_message_at: string | Date | null; last_body: string | null } | undefined;
  return {
    unreadCount: row?.unread_count ?? 0,
    lastMessageAt: row?.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    lastBody: row?.last_body ?? null,
  };
}

export async function listChatChannels(
  guildId: string,
  discordId: string,
): Promise<{ channels: ChatChannelSummary[]; canAccessCommissionerChat: boolean }> {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await requireLinkedUserId(discordId);

  const [leagueAggregate, gameChannelsResult] = await Promise.all([
    loadLeagueAggregate(userId, context.leagueId),
    listGameChatChannels(guildId),
  ]);

  const gameChannelIds = gameChannelsResult.channels.map((c) => c.gameChannelId);
  const [gameAggregates, gameParticipants] = await Promise.all([
    loadGameAggregates(userId, gameChannelIds),
    loadGameParticipants(gameChannelIds),
  ]);

  const channels: ChatChannelSummary[] = [
    {
      id: context.leagueId,
      type: "league" as ChatChannelType,
      label: "League Chat",
      unreadCount: leagueAggregate.unreadCount,
      lastMessagePreview: leagueAggregate.lastBody,
      lastMessageAt: leagueAggregate.lastMessageAt,
    },
    ...gameChannelsResult.channels.map((c): ChatChannelSummary => {
      const aggregate = gameAggregates.get(c.gameChannelId);
      const participants = gameParticipants.get(c.gameChannelId);
      return {
        id: c.gameChannelId,
        type: "game",
        label: c.label,
        unreadCount: aggregate?.unreadCount ?? 0,
        lastMessagePreview: aggregate?.lastBody ?? null,
        lastMessageAt: aggregate?.lastMessageAt ?? null,
        participantFlag: participants ? participants.away === userId || participants.home === userId : false,
      };
    }),
  ];

  let canAccessCommissionerChat = false;
  try {
    await assertGuildPermission(guildId, discordId, "co_commissioner");
    canAccessCommissionerChat = true;
  } catch {
    canAccessCommissionerChat = false;
  }

  if (canAccessCommissionerChat) {
    const commissionerAggregate = await loadCommissionerAggregate(userId, guildId);
    channels.push({
      id: guildId,
      type: "commissioner",
      label: "Commissioner Chat",
      unreadCount: commissionerAggregate.unreadCount,
      lastMessagePreview: commissionerAggregate.lastBody,
      lastMessageAt: commissionerAggregate.lastMessageAt,
    });
  }

  return { channels, canAccessCommissionerChat };
}

export async function markChannelRead(input: {
  guildId: string;
  discordId: string;
  channelType: ChatChannelType;
  channelId: string;
  lastReadMessageId: string;
}): Promise<{ ok: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await requireLinkedUserId(input.discordId);
  await getPgPool().query(
    `
      insert into rec_chat_read_state (user_id, league_id, channel_type, channel_id, last_read_message_id, last_read_at, updated_at)
      values ($1, $2, $3, $4, $5, now(), now())
      on conflict (user_id, channel_type, channel_id)
      do update set last_read_message_id = excluded.last_read_message_id, last_read_at = now(), updated_at = now()
    `,
    [userId, context.leagueId, input.channelType, input.channelId, input.lastReadMessageId],
  );
  return { ok: true };
}
