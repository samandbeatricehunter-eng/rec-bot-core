// Thin composition layer over league-chat, game-chat, and commissioner-chat — does not
// duplicate their send/list logic. Adds the one thing none of them track today: per-user
// unread state, via rec_chat_read_state, so the Universal Chat Drawer can show one badge
// across all three chat surfaces without each surface reinventing read tracking.
import { randomUUID } from "node:crypto";
import type { ChatChannelSummary, ChatChannelType } from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { resolveChatAuthor } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { listGameChatChannels } from "../game-chat/game-chat.service.js";
import { broadcastChatEvent } from "./chat-realtime.js";

const CHAT_ATTACHMENT_BUCKET = "chat-attachments";
export const SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Same Supabase Storage upload pattern as box-score screenshots (persistUploadedImageBuffer),
// a dedicated bucket so chat uploads don't mix with box-score storage.
export async function uploadChatAttachmentImage(buffer: Buffer, contentType: string): Promise<{ storageKey: string; url: string }> {
  const ext = contentType === "image/jpeg" ? "jpeg" : contentType === "image/webp" ? "webp" : contentType === "image/gif" ? "gif" : "png";
  const storageKey = `uploads/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(CHAT_ATTACHMENT_BUCKET).upload(storageKey, buffer, { contentType, upsert: true });
  if (error) throw new ApiError(500, "Failed to upload image.", error);
  const { data } = supabase.storage.from(CHAT_ATTACHMENT_BUCKET).getPublicUrl(storageKey);
  if (!data?.publicUrl) throw new ApiError(500, "Failed to resolve uploaded image URL.");
  return { storageKey, url: data.publicUrl };
}

export type ChatAttachment = {
  id: string;
  messageId: string;
  originalUrl: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
};

// Reactions and attachments are keyed by (channelType, messageId) — neither carries the
// channelId broadcasting needs, so resolve it from the message's own home table. One extra
// query, only on the (infrequent relative to messages) react/attach path.
const CHANNEL_ID_COLUMN_BY_TYPE: Record<ChatChannelType, { table: string; column: string }> = {
  league: { table: "rec_league_chat_messages", column: "league_id" },
  game: { table: "rec_game_chat_messages", column: "game_channel_id" },
  commissioner: { table: "rec_commissioner_chat_messages", column: "guild_id" },
};

async function resolveChannelIdForMessage(channelType: ChatChannelType, messageId: string): Promise<string | null> {
  const { table, column } = CHANNEL_ID_COLUMN_BY_TYPE[channelType];
  const { data } = await supabase.from(table).select(column).eq("id", messageId).maybeSingle();
  return (data as Record<string, string> | null)?.[column] ?? null;
}

export async function attachToMessage(input: {
  channelType: ChatChannelType;
  messageId: string;
  storageKey: string;
  url: string;
  mimeType: string;
  filename?: string | null;
  sizeBytes?: number | null;
}): Promise<{ attachment: ChatAttachment }> {
  const { data, error } = await supabase
    .from("rec_chat_attachments")
    .insert({
      channel_type: input.channelType,
      message_id: input.messageId,
      storage_key: input.storageKey,
      original_url: input.url,
      mime_type: input.mimeType,
      filename: input.filename ?? null,
      size_bytes: input.sizeBytes ?? null,
    })
    .select("id,message_id,original_url,mime_type,filename,size_bytes")
    .single();
  if (error) throw new ApiError(500, "Failed to attach file to message.", error);
  const channelId = await resolveChannelIdForMessage(input.channelType, input.messageId);
  if (channelId) broadcastChatEvent(input.channelType, channelId, { kind: "attachment", messageId: input.messageId });
  return {
    attachment: {
      id: data.id,
      messageId: data.message_id,
      originalUrl: data.original_url,
      mimeType: data.mime_type,
      filename: data.filename,
      sizeBytes: data.size_bytes,
    },
  };
}

export async function listChatAttachments(channelType: ChatChannelType, messageIds: string[]): Promise<{ attachments: ChatAttachment[] }> {
  if (!messageIds.length) return { attachments: [] };
  const { data, error } = await supabase
    .from("rec_chat_attachments")
    .select("id,message_id,original_url,mime_type,filename,size_bytes")
    .eq("channel_type", channelType)
    .in("message_id", messageIds);
  if (error) throw new ApiError(500, "Failed to load attachments.", error);
  return {
    attachments: (data ?? []).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      originalUrl: row.original_url,
      mimeType: row.mime_type,
      filename: row.filename,
      sizeBytes: row.size_bytes,
    })),
  };
}

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

export type ChatReactionSummary = { messageId: string; emojiKey: string; count: number; mine: boolean };

// Reactions span all three chat tables (league/game/commissioner) via the channel_type
// discriminator, same pattern as rec_chat_read_state — no changes to the three send/list
// services, this is purely additive.
export async function listChatReactions(input: {
  channelType: ChatChannelType;
  messageIds: string[];
  discordId: string;
}): Promise<{ reactions: ChatReactionSummary[] }> {
  if (!input.messageIds.length) return { reactions: [] };
  const { rows } = await getPgPool().query(
    `
      select message_id, emoji_key, count(*)::int as count, bool_or(discord_id = $3) as mine
      from rec_chat_reactions
      where channel_type = $1 and message_id = any($2::uuid[])
      group by message_id, emoji_key
    `,
    [input.channelType, input.messageIds, input.discordId],
  );
  return {
    reactions: (rows as Array<{ message_id: string; emoji_key: string; count: number; mine: boolean }>).map((row) => ({
      messageId: row.message_id,
      emojiKey: row.emoji_key,
      count: row.count,
      mine: row.mine,
    })),
  };
}

export async function toggleChatReaction(input: {
  discordId: string;
  channelType: ChatChannelType;
  messageId: string;
  emojiKey: string;
}): Promise<{ reacted: boolean }> {
  const existing = await getPgPool().query(
    `select id from rec_chat_reactions where channel_type = $1 and message_id = $2 and discord_id = $3 and emoji_key = $4`,
    [input.channelType, input.messageId, input.discordId, input.emojiKey],
  );
  const channelId = await resolveChannelIdForMessage(input.channelType, input.messageId);
  if (existing.rows.length) {
    await getPgPool().query(`delete from rec_chat_reactions where id = $1`, [existing.rows[0].id]);
    if (channelId) broadcastChatEvent(input.channelType, channelId, { kind: "reaction", messageId: input.messageId });
    return { reacted: false };
  }
  const author = await resolveChatAuthor(input.discordId);
  await getPgPool().query(
    `insert into rec_chat_reactions (channel_type, message_id, user_id, discord_id, emoji_key, source) values ($1, $2, $3, $4, $5, 'site')`,
    [input.channelType, input.messageId, author.userId, input.discordId, input.emojiKey],
  );
  if (channelId) broadcastChatEvent(input.channelType, channelId, { kind: "reaction", messageId: input.messageId });
  return { reacted: true };
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
