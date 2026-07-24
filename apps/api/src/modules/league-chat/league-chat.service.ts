import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { resolveChatAuthor, resolveChatDisplay } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

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
  if (assignments.error) throw new ApiError(500, "Failed to load league members.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))];
  if (!userIds.length) return { members: [] };

  const [usersRes, discordRes, presenceRes] = await Promise.all([
    supabase.from("rec_users").select("id,username,display_name,supabase_auth_user_id").in("id", userIds),
    supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds),
    supabase.from("rec_hub_presence_heartbeats").select("user_id,last_seen_at").eq("league_id", context.leagueId).in("user_id", userIds),
  ]);
  if (usersRes.error) throw new ApiError(500, "Failed to load user identities.", usersRes.error);
  if (discordRes.error) throw new ApiError(500, "Failed to load Discord identities.", discordRes.error);
  if (presenceRes.error) throw new ApiError(500, "Failed to load presence.", presenceRes.error);

  const discordByUser = new Map<string, any>((discordRes.data ?? []).map((row: any) => [row.user_id, row]));
  const presenceByUser = new Map<string, string | null>((presenceRes.data ?? []).map((row: any) => [row.user_id, row.last_seen_at]));
  const onlineCutoffMs = Date.now() - ONLINE_WINDOW_SECONDS * 1000;

  const members: LeagueChatMember[] = (usersRes.data ?? []).map((user: any) => {
    const discord = discordByUser.get(user.id) ?? null;
    const { displayName, isRegistered } = resolveChatDisplay(user, discord);
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
  if (error) throw new ApiError(500, "Failed to record presence.", error);
  return { ok: true };
}

export async function listLeagueChatMessages(guildId: string, sinceIso?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  let query = supabase
    .from("rec_league_chat_messages")
    .select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,body,created_at")
    .eq("league_id", context.leagueId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (sinceIso) query = query.gt("created_at", sinceIso);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to load league chat messages.", error);
  return { messages: (data ?? []).reverse() };
}

export async function postLeagueChatMessage(input: { guildId: string; discordId: string; body: string }) {
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
    })
    .select("id,author_user_id,author_discord_id,author_display_name,is_discord_only,body,created_at")
    .single();
  if (error) throw new ApiError(500, "Failed to post message.", error);
  return { message: data };
}

// Called from league-week.service.ts's setLeagueWeek on the same seasonNumber-changed branch
// that already wipes CPU team season stats — the one authoritative season-rollover trigger.
export async function wipeLeagueChatForSeasonRollover(leagueId: string): Promise<void> {
  const { error } = await supabase.from("rec_league_chat_messages").delete().eq("league_id", leagueId);
  if (error) throw error;
}
