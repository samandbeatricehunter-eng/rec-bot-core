import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { resolveChatAuthor, resolveChatDisplay } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getGameChannelByDiscordId } from "../game-channels/game-channels.service.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { broadcastChatEvent } from "../chat/chat-realtime.js";

const MESSAGE_PAGE_SIZE = 300;

export type GameChatChannel = { gameChannelId: string; gameId: string | null; label: string; awayTeamName: string; homeTeamName: string };

// Whole-league visibility (matches Discord's guild-wide channel visibility, not just the two
// coaches) — every active game channel for the league's current season/week is listed, and any
// league member can read/post in any of them.
export async function listGameChatChannels(guildId: string): Promise<{ channels: GameChatChannel[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);

  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("id,game_id,away_team_id,home_team_id,created_at")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load game chat channels.", error);

  const teamIds = [...new Set((data ?? []).flatMap((row: any) => [row.away_team_id, row.home_team_id]).filter(Boolean))];
  const teamsRes = teamIds.length
    ? await supabase.from("rec_teams").select("id,name").in("id", teamIds)
    : { data: [] as any[], error: null };
  if (teamsRes.error) throw new ApiError(500, "Failed to load team names.", teamsRes.error);
  const teamById = new Map<string, string>((teamsRes.data ?? []).map((team: any) => [team.id, team.name]));

  return {
    channels: (data ?? []).map((row: any) => {
      const awayTeamName = teamById.get(row.away_team_id) ?? "Away";
      const homeTeamName = teamById.get(row.home_team_id) ?? "Home";
      return { gameChannelId: row.id, gameId: row.game_id, label: `${awayTeamName} at ${homeTeamName}`, awayTeamName, homeTeamName };
    }),
  };
}

async function requireGameChannelInLeague(guildId: string, gameChannelId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const channel = await supabase
    .from("rec_game_channels")
    .select("id,league_id,game_id,discord_channel_id,away_user_id,home_user_id")
    .eq("id", gameChannelId)
    .maybeSingle();
  if (channel.error) throw new ApiError(500, "Failed to load game channel.", channel.error);
  if (!channel.data || String(channel.data.league_id) !== context.leagueId) throw new ApiError(404, "Game channel not found.");
  return channel.data as { id: string; league_id: string; game_id: string | null; discord_channel_id: string | null; away_user_id: string | null; home_user_id: string | null };
}

export async function getGameChatMessages(input: { guildId: string; gameChannelId: string }) {
  await requireGameChannelInLeague(input.guildId, input.gameChannelId);
  const { data, error } = await supabase
    .from("rec_game_chat_messages")
    .select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,source,body,created_at,edited_at,reply_to_message_id")
    .eq("game_channel_id", input.gameChannelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(MESSAGE_PAGE_SIZE);
  if (error) throw new ApiError(500, "Failed to load game chat messages.", error);
  return { messages: data ?? [] };
}

export async function editGameChatMessage(input: { guildId: string; discordId: string; messageId: string; body: string }) {
  const trimmed = input.body.trim();
  if (!trimmed) throw new ApiError(400, "Message can't be empty.");
  if (trimmed.length > 2000) throw new ApiError(400, "Message is too long (2000 characters max).");
  const { data, error } = await supabase
    .from("rec_game_chat_messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", input.messageId)
    .eq("author_discord_id", input.discordId)
    .is("deleted_at", null)
    .select("id,game_channel_id,author_user_id,author_discord_id,author_display_name,is_discord_only,source,body,created_at,edited_at")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to edit message.", error);
  if (!data) throw new ApiError(404, "Message not found, or you're not its author.");
  broadcastChatEvent("game", data.game_channel_id, { kind: "edit", row: data });
  return { message: data };
}

export async function deleteGameChatMessage(input: { guildId: string; discordId: string; messageId: string }) {
  const { data, error } = await supabase
    .from("rec_game_chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.messageId)
    .eq("author_discord_id", input.discordId)
    .is("deleted_at", null)
    .select("id,game_channel_id")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to delete message.", error);
  if (!data) throw new ApiError(404, "Message not found, or you're not its author.");
  broadcastChatEvent("game", data.game_channel_id, { kind: "delete", messageId: data.id });
  return { ok: true as const };
}

export async function sendGameChatMessage(input: { guildId: string; discordId: string; gameChannelId: string; body: string; replyToMessageId?: string | null }) {
  const trimmed = input.body.trim();
  if (!trimmed) throw new ApiError(400, "Message can't be empty.");
  if (trimmed.length > 2000) throw new ApiError(400, "Message is too long (2000 characters max).");
  const channel = await requireGameChannelInLeague(input.guildId, input.gameChannelId);
  const author = await resolveChatAuthor(input.discordId);

  const { data, error } = await supabase
    .from("rec_game_chat_messages")
    .insert({
      game_channel_id: channel.id,
      league_id: channel.league_id,
      game_id: channel.game_id,
      author_user_id: author.userId,
      author_discord_id: input.discordId,
      author_display_name: author.displayName,
      is_discord_only: author.isDiscordOnly,
      source: "site",
      body: trimmed,
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,source,body,created_at,reply_to_message_id")
    .single();
  if (error) throw new ApiError(500, "Failed to send game chat message.", error);
  broadcastChatEvent("game", channel.id, { kind: "message", row: data });

  if (channel.discord_channel_id) {
    void forwardToDiscord({
      discordChannelId: channel.discord_channel_id,
      senderDiscordId: input.discordId,
      senderDisplayName: author.displayName,
      awayUserId: channel.away_user_id,
      homeUserId: channel.home_user_id,
      body: trimmed,
    }).catch((forwardError) => console.error("[ERROR] Failed to forward game chat message to Discord (non-fatal):", forwardError));
  }

  return { message: data };
}

async function forwardToDiscord(input: {
  discordChannelId: string;
  senderDiscordId: string;
  senderDisplayName: string;
  awayUserId: string | null;
  homeUserId: string | null;
  body: string;
}) {
  const candidateUserIds = [input.awayUserId, input.homeUserId].filter((id): id is string => Boolean(id));
  const accountsRes = candidateUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", candidateUserIds)
    : { data: [] as any[], error: null };
  if (accountsRes.error) throw accountsRes.error;
  const opponentDiscordId = (accountsRes.data ?? [])
    .map((row: any) => String(row.discord_id))
    .find((discordId: string) => discordId !== input.senderDiscordId) ?? null;

  const mention = opponentDiscordId ? `<@${opponentDiscordId}> ` : "";
  await postDiscordChannelMessage(input.discordChannelId, {
    content: `${mention}**${input.senderDisplayName}** (site): ${input.body}`.slice(0, 2000),
    allowed_mentions: { users: opponentDiscordId ? [opponentDiscordId] : [] },
  });
}

// Bot-only ingest (internal API key) — a Discord message posted in a tracked game channel gets
// mirrored into the site chat. Never re-forwards to Discord (that direction only happens via
// sendGameChatMessage above), so there's no echo loop between the two directions.
export async function ingestDiscordGameChatMessage(input: {
  discordChannelId: string;
  discordUserId: string;
  discordMessageId: string;
  content: string;
  images?: Array<{ url: string; mimeType: string }>;
}): Promise<{ ingested: boolean }> {
  const trimmed = input.content.trim();
  const images = input.images ?? [];
  if (!trimmed && !images.length) return { ingested: false };

  const channel = await getGameChannelByDiscordId(input.discordChannelId);
  if (!channel || channel.status !== "active") return { ingested: false };

  const discordRes = await supabase.from("rec_discord_accounts").select("user_id,username,global_name").eq("discord_id", input.discordUserId).maybeSingle();
  if (discordRes.error) throw new ApiError(500, "Failed to load Discord author.", discordRes.error);
  const userId: string | null = discordRes.data?.user_id ?? null;
  let userRow: any = null;
  if (userId) {
    const userRes = await supabase.from("rec_users").select("username,display_name,supabase_auth_user_id").eq("id", userId).maybeSingle();
    if (userRes.error) throw new ApiError(500, "Failed to load user identity.", userRes.error);
    userRow = userRes.data ?? null;
  }
  const { displayName, isRegistered } = resolveChatDisplay(userRow, discordRes.data ?? null);

  const inserted = await supabase.from("rec_game_chat_messages").insert({
    game_channel_id: channel.id,
    league_id: channel.league_id,
    game_id: channel.game_id,
    author_user_id: userId,
    author_discord_id: input.discordUserId,
    author_display_name: displayName,
    is_discord_only: !isRegistered,
    source: "discord",
    discord_message_id: input.discordMessageId,
    // body has a >=1-char CHECK constraint — an image-only Discord message (no caption) trims
    // to "", which would otherwise fail that constraint and 500 on every such message.
    body: (trimmed || "📎 Image").slice(0, 2000),
  }).select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,source,discord_message_id,body,created_at").single();
  // Unique partial index on discord_message_id — a retried ingest hits a conflict, which is
  // "already ingested", not a real failure.
  if (inserted.error && (inserted.error as any).code !== "23505") throw new ApiError(500, "Failed to ingest Discord game chat message.", inserted.error);
  if (!inserted.error) {
    broadcastChatEvent("game", channel.id, { kind: "message", row: inserted.data });
    // Discord CDN URLs are referenced directly (not re-uploaded to our own storage) — they're
    // stable for the message's lifetime in practice, but unlike site-uploaded attachments
    // there's no storage_key we own, so storage_key just echoes the source URL.
    for (const image of images) {
      const attached = await supabase.from("rec_chat_attachments").insert({
        channel_type: "game",
        message_id: inserted.data.id,
        storage_key: image.url,
        original_url: image.url,
        mime_type: image.mimeType,
      });
      if (!attached.error) broadcastChatEvent("game", channel.id, { kind: "attachment", messageId: inserted.data.id });
    }
  }
  return { ingested: true };
}

// System rows (no author) for confirmations like "Force Win requested" — not user-authored, so
// no Discord forward. Best-effort: callers should not fail their own request if this errors.
export async function postGameChatSystemMessage(input: { gameChannelId: string; leagueId: string; gameId: string | null; body: string }) {
  const { data, error } = await supabase.from("rec_game_chat_messages").insert({
    game_channel_id: input.gameChannelId,
    league_id: input.leagueId,
    game_id: input.gameId,
    author_user_id: null,
    author_discord_id: null,
    author_display_name: "REC Leagues",
    is_discord_only: false,
    source: "system",
    body: input.body.slice(0, 2000),
  }).select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,source,body,created_at").single();
  if (error) throw new ApiError(500, "Failed to post system message.", error);
  broadcastChatEvent("game", input.gameChannelId, { kind: "message", row: data });
}
