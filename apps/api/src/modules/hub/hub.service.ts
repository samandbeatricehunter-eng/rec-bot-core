import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getWeeklyH2hGames } from "../league-week/advance-results.service.js";
import { getUserMenuProfileByDiscordId } from "../users/user.service.js";

export const HUB_REACTION_KEYS = ["like", "dislike", "TOTY", "COTY", "ROTY", "IOTY", "HOTY"] as const;
export type HubReactionKey = (typeof HUB_REACTION_KEYS)[number];

async function userIdForDiscord(discordId: string) {
  const result = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load your REC account.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

function videoUrl(content: string | null) {
  if (!content) return null;
  const urls = content.match(/https?:\/\/\S+/gi) ?? [];
  return urls.find((url) => /\.(mp4|mov|webm|mkv)(?:\?|$)/i.test(url)) ?? urls[0] ?? (/^https?:\/\//i.test(content) ? content : null);
}

export async function getHub(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const canManageLeague = await assertGuildPermission(guildId, discordId, "co_commissioner").then(() => true).catch(() => false);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);

  const [announcements, headlines, highlights, matchups, myTeam] = await Promise.all([
    supabase.from("rec_hub_announcements").select("id,title,body,season_number,week_number,published_at").eq("league_id", context.leagueId).order("published_at", { ascending: false }).limit(8),
    supabase.from("rec_game_stories").select("id,season,week,headline,body,primary_angle,created_at").eq("league_id", context.leagueId).order("created_at", { ascending: false }).limit(12),
    supabase.from("rec_highlight_posts").select("id,user_id,team_id,season_number,week_number,message_url,content,created_at,user:rec_users(display_name),team:rec_teams(name,abbreviation)").eq("league_id", context.leagueId).order("created_at", { ascending: false }).limit(18),
    getWeeklyH2hGames(guildId),
    getUserMenuProfileByDiscordId(discordId, guildId),
  ]);
  if (announcements.error) throw new ApiError(500, "Failed to load hub announcements.", announcements.error);
  if (headlines.error) throw new ApiError(500, "Failed to load hub headlines.", headlines.error);
  if (highlights.error) throw new ApiError(500, "Failed to load highlights.", highlights.error);

  const ids = (highlights.data ?? []).map((item: any) => item.id);
  const reactions = ids.length
    ? await supabase.from("rec_highlight_reactions").select("highlight_post_id,user_id,reaction_key").in("highlight_post_id", ids)
    : { data: [], error: null };
  if (reactions.error) throw new ApiError(500, "Failed to load highlight reactions.", reactions.error);

  return {
    league: {
      id: context.leagueId,
      name: context.rec_leagues.name,
      game: context.rec_leagues.game,
      seasonNumber,
      weekNumber: Number(context.rec_leagues.current_week ?? 1),
      seasonStage: context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "preseason",
    },
    canManageLeague,
    announcements: announcements.data ?? [],
    headlines: headlines.data ?? [],
    matchups,
    myTeam,
    highlights: (highlights.data ?? []).map((item: any) => {
      const rows = (reactions.data ?? []).filter((reaction: any) => reaction.highlight_post_id === item.id);
      const counts = Object.fromEntries(HUB_REACTION_KEYS.map((key) => [key, rows.filter((reaction: any) => reaction.reaction_key === key).length]));
      return { ...item, videoUrl: videoUrl(item.content), reactionCounts: counts, myReactions: rows.filter((reaction: any) => reaction.user_id === userId).map((reaction: any) => reaction.reaction_key) };
    }),
  };
}

export async function toggleHubHighlightReaction(input: { guildId: string; discordId: string; highlightId: string; reactionKey: HubReactionKey }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const highlight = await supabase.from("rec_highlight_posts").select("id").eq("id", input.highlightId).eq("league_id", context.leagueId).maybeSingle();
  if (highlight.error) throw new ApiError(500, "Failed to verify highlight.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight not found.");

  const existing = await supabase.from("rec_highlight_reactions").select("id").eq("highlight_post_id", input.highlightId).eq("user_id", userId).eq("reaction_key", input.reactionKey).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to read reaction.", existing.error);
  if (existing.data) {
    const removed = await supabase.from("rec_highlight_reactions").delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "Failed to remove reaction.", removed.error);
  } else {
    const mutuallyExclusive = input.reactionKey === "like" || input.reactionKey === "dislike" ? ["like", "dislike"] : ["TOTY", "COTY", "ROTY", "IOTY", "HOTY"];
    const cleared = await supabase.from("rec_highlight_reactions").delete().eq("highlight_post_id", input.highlightId).eq("user_id", userId).in("reaction_key", mutuallyExclusive);
    if (cleared.error) throw new ApiError(500, "Failed to update reaction.", cleared.error);
    const inserted = await supabase.from("rec_highlight_reactions").insert({ id: randomUUID(), highlight_post_id: input.highlightId, user_id: userId, reaction_key: input.reactionKey, created_at: new Date().toISOString() });
    if (inserted.error) throw new ApiError(500, "Failed to save reaction.", inserted.error);
  }
  return { ok: true };
}

export async function recordHubAnnouncement(input: { guildId: string; title: string; body: string; discordChannelId?: string | null; discordMessageId?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const result = await supabase.from("rec_hub_announcements").insert({
    id: randomUUID(), league_id: context.leagueId, title: input.title, body: input.body,
    season_number: Number(context.rec_leagues.season_number ?? 1), week_number: Number(context.rec_leagues.current_week ?? 1),
    discord_channel_id: input.discordChannelId ?? null, discord_message_id: input.discordMessageId ?? null,
    published_at: new Date().toISOString(), created_at: new Date().toISOString(),
  });
  if (result.error) throw new ApiError(500, "Failed to record hub announcement.", result.error);
  return { recorded: true };
}
