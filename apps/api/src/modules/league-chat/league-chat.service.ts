import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { resolveChatAuthor, resolveChatDisplay } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getGuildMemberDisplayNameMap, postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { broadcastChatEvent } from "../chat/chat-realtime.js";

const MESSAGE_PAGE_SIZE = 300;
const ONLINE_WINDOW_SECONDS = 60;

export type LeagueChatMember = {
  userId: string;
  discordId: string | null;
  username: string | null;
  displayName: string;
  isRegistered: boolean;
  isDiscordOnly: boolean;
  online: boolean;
  lastSeenAt: string | null;
};

// Roster + presence + @-mention source, all from one query set — reuses the same
// rec_team_assignments (active, not ended) join to rec_users/rec_discord_accounts that
// getLeagueUserIdentities (user.service.ts) uses, plus rec_hub_presence_heartbeats for online
// status. "online" is computed at read time (no cron), same lazy idiom as other chat purges.
export async function listLeagueMembersForChat(guildId: string): Promise<{ members: LeagueChatMember[] }> {
  const context = await getCurrentLeagueContext(guildId);

  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", context.leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "We couldn't load league members. Please try again.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  if (!userIds.length) return { members: [] };

  const [usersRes, discordRes, presenceRes] = await Promise.all([
    supabase.from("rec_users").select("id,username,display_name,supabase_auth_user_id").in("id", userIds),
    supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds),
    supabase.from("rec_hub_presence_heartbeats").select("user_id,last_seen_at").eq("league_id", context.leagueId).in("user_id", userIds),
  ]);
  if (usersRes.error) throw new ApiError(500, "We couldn't load user identities. Please try again.", usersRes.error);
  if (discordRes.error) throw new ApiError(500, "We couldn't load Discord identities. Please try again.", discordRes.error);
  if (presenceRes.error) throw new ApiError(500, "We couldn't load presence. Please try again.", presenceRes.error);

  const discordByUser = new Map<string, any>((discordRes.data ?? []).map((row: any) => [row.user_id, row]));
  const guildDisplayNames = await getGuildMemberDisplayNameMap(guildId).catch(
    () => new Map<string, string>(),
  );
  const presenceByUser = new Map<string, string | null>((presenceRes.data ?? []).map((row: any) => [row.user_id, row.last_seen_at]));
  const onlineCutoffMs = Date.now() - ONLINE_WINDOW_SECONDS * 1000;

  const members: LeagueChatMember[] = (usersRes.data ?? []).map((user: any) => {
    const discord = discordByUser.get(user.id) ?? null;
    const { displayName: fallbackDisplayName, isRegistered } = resolveChatDisplay(user, discord);
    const serverNickname = discord?.discord_id
      ? guildDisplayNames.get(String(discord.discord_id)) ?? null
      : null;
    const siteName = String(user.username ?? "").trim();
    const displayName =
      isRegistered && siteName
        ? serverNickname
          ? `${siteName} (${serverNickname})`
          : siteName
        : serverNickname ?? fallbackDisplayName;
    const lastSeenAt: string | null = presenceByUser.get(user.id) ?? null;
    return {
      userId: user.id,
      discordId: discord?.discord_id ?? null,
      username: user.username ?? null,
      displayName,
      isRegistered,
      isDiscordOnly: !isRegistered,
      online: Boolean(lastSeenAt && new Date(lastSeenAt).getTime() > onlineCutoffMs),
      lastSeenAt,
    };
  });
  members.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { members };
}

export async function heartbeat(input: { guildId: string; discordId: string }): Promise<{ ok: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const author = await resolveChatAuthor(input.discordId);
  if (!author.userId) return { ok: true };
  const { error } = await supabase
    .from("rec_hub_presence_heartbeats")
    .upsert(
      { league_id: context.leagueId, user_id: author.userId, discord_id: input.discordId, last_seen_at: new Date().toISOString() },
      { onConflict: "league_id,user_id" },
    );
  if (error) throw new ApiError(500, "We couldn't record presence. Please try again.", error);
  return { ok: true };
}

export async function listLeagueChatMessages(guildId: string, sinceIso?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  let query = supabase
    .from("rec_league_chat_messages")
    .select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,body,created_at,edited_at,reply_to_message_id")
    .eq("league_id", context.leagueId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (sinceIso) query = query.gt("created_at", sinceIso);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "We couldn't load league chat messages. Please try again.", error);
  return { messages: (data ?? []).reverse() };
}

export async function editLeagueChatMessage(input: { guildId: string; discordId: string; messageId: string; body: string }) {
  const trimmed = input.body.trim();
  if (!trimmed) throw new ApiError(400, "Message can't be empty.");
  if (trimmed.length > 2000) throw new ApiError(400, "Message is too long (2000 characters max).");
  const { data, error } = await supabase
    .from("rec_league_chat_messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", input.messageId)
    .eq("author_discord_id", input.discordId)
    .is("deleted_at", null)
    .select("id,league_id,author_user_id,author_discord_id,author_display_name,is_discord_only,body,created_at,edited_at")
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't edit that message. Please try again.", error);
  if (!data) throw new ApiError(404, "Message not found, or you're not its author.");
  broadcastChatEvent("league", data.league_id, { kind: "edit", row: data });
  return { message: data };
}

export async function deleteLeagueChatMessage(input: { guildId: string; discordId: string; messageId: string }) {
  const { data, error } = await supabase
    .from("rec_league_chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.messageId)
    .eq("author_discord_id", input.discordId)
    .is("deleted_at", null)
    .select("id,league_id")
    .maybeSingle();
  if (error) throw new ApiError(500, "We couldn't delete that message. Please try again.", error);
  if (!data) throw new ApiError(404, "Message not found, or you're not its author.");
  broadcastChatEvent("league", data.league_id, { kind: "delete", messageId: data.id });
  return { ok: true as const };
}

export async function postLeagueChatMessage(input: { guildId: string; discordId: string; body: string; replyToMessageId?: string | null }) {
  const trimmed = input.body.trim();
  if (!trimmed) throw new ApiError(400, "Message can't be empty.");
  if (trimmed.length > 2000) throw new ApiError(400, "Message is too long (2000 characters max).");
  const context = await getCurrentLeagueContext(input.guildId);
  const author = await resolveChatAuthor(input.discordId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);

  const { data, error } = await supabase
    .from("rec_league_chat_messages")
    .insert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      author_user_id: author.userId,
      author_discord_id: input.discordId,
      author_display_name: author.displayName,
      is_discord_only: author.isDiscordOnly,
      body: trimmed,
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,body,created_at,reply_to_message_id")
    .single();
  if (error) throw new ApiError(500, "We couldn't post that message. Please try again.", error);
  const mainChatChannelId = (context.routes as any)?.main_chat_channel_id as string | null | undefined;
  if (mainChatChannelId) {
    const assignment = author.userId
      ? await supabase
          .from("rec_team_assignments")
          .select("team:rec_teams(name)")
          .eq("league_id", context.leagueId)
          .eq("user_id", author.userId)
          .eq("assignment_status", "active")
          .is("ended_at", null)
          .limit(1)
          .maybeSingle()
      : null;
    const teamName = (assignment?.data as any)?.team?.name ?? "League Member";
    const forwarded = await postDiscordChannelMessage(
      mainChatChannelId,
      { content: `@${author.displayName} · ${teamName}: "${trimmed}"` },
    ).catch(async (forwardError) => {
      console.error("[ERROR] Failed to forward league chat to Discord:", forwardError);
      await supabase.from("rec_league_chat_messages").delete().eq("id", data.id);
      throw new ApiError(502, "The message was saved to league chat, but Discord rejected the relay. Check the bot's access to the assigned Main Chat Channel.");
    });
    if (!forwarded) {
      await supabase.from("rec_league_chat_messages").delete().eq("id", data.id);
      throw new ApiError(502, "The message was saved to league chat, but Discord rejected the relay. Check the bot's access to the assigned Main Chat Channel.");
    }
  }
  broadcastChatEvent("league", context.leagueId, { kind: "message", row: data });
  return { message: data };
}

export async function ingestDiscordLeagueChatMessage(input: {
  discordChannelId: string;
  discordUserId: string;
  discordMessageId: string;
  content: string;
  images?: Array<{ url: string; mimeType: string }>;
}) {
  const trimmed = input.content.trim();
  const images = input.images ?? [];
  if (!trimmed && !images.length) return { ingested: false };
  const route = await supabase
    .from("rec_server_routes")
    .select("server_id")
    .eq("main_chat_channel_id", input.discordChannelId)
    .maybeSingle();
  if (route.error) throw new ApiError(500, "We couldn't find the main chat channel. Please try again.", route.error);
  if (!route.data?.server_id) return { ingested: false };
  const server = await supabase
    .from("rec_discord_servers")
    .select("guild_id")
    .eq("id", route.data.server_id)
    .maybeSingle();
  if (server.error || !server.data?.guild_id) return { ingested: false };
  const context = await getCurrentLeagueContext(String(server.data.guild_id));
  const author = await resolveChatAuthor(input.discordUserId);
  const existing = await supabase
    .from("rec_league_chat_messages")
    .select("id")
    .eq("discord_message_id", input.discordMessageId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't check that Discord league chat message. Please try again.", existing.error);
  if (existing.data) return { ingested: true };
  const inserted = await supabase.from("rec_league_chat_messages").insert({
    league_id: context.leagueId,
    season_number: Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1),
    author_user_id: author.userId,
    author_discord_id: input.discordUserId,
    author_display_name: author.displayName,
    is_discord_only: author.isDiscordOnly,
    source: "discord",
    discord_message_id: input.discordMessageId,
    // body has a >=1-char CHECK constraint — an image-only Discord message (no caption) trims
    // to "", which would otherwise fail that constraint and 500 on every such message.
    body: (trimmed || "📎 Image").slice(0, 2000),
  }).select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,source,discord_message_id,body,created_at").single();
  if (inserted.error) throw new ApiError(500, "We couldn't import that Discord league chat message. Please try again.", inserted.error);
  broadcastChatEvent("league", context.leagueId, { kind: "message", row: inserted.data });
  // See game-chat.service.ts's ingestDiscordGameChatMessage for why storage_key echoes the
  // source URL instead of pointing at our own storage.
  for (const image of images) {
    const attached = await supabase.from("rec_chat_attachments").insert({
      channel_type: "league",
      message_id: inserted.data.id,
      storage_key: image.url,
      original_url: image.url,
      mime_type: image.mimeType,
    });
    if (!attached.error) broadcastChatEvent("league", context.leagueId, { kind: "attachment", messageId: inserted.data.id });
  }
  return { ingested: true };
}

// Called from league-week.service.ts's setLeagueWeek on the same seasonNumber-changed branch
// that already wipes CPU team season stats — the one authoritative season-rollover trigger.
export async function wipeLeagueChatForSeasonRollover(leagueId: string): Promise<void> {
  const { error } = await supabase.from("rec_league_chat_messages").delete().eq("league_id", leagueId);
  if (error) throw error;
}
