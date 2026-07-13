import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getWeeklyH2hGames } from "../league-week/advance-results.service.js";
import { getUserMenuProfileByDiscordId, getUserSnapshot } from "../users/user.service.js";
import { mirrorHighlightMedia } from "../highlights/highlights.service.js";
import { buildRoundtableDiscussion } from "./roundtable.js";

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

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

function discordCdnUrlIsFresh(url: string | null) {
  if (!url || !url.includes("cdn.discordapp.com")) return Boolean(url);
  try {
    const expiresHex = new URL(url).searchParams.get("ex");
    return !expiresHex || Number.parseInt(expiresHex, 16) * 1000 > Date.now() + 5 * 60_000;
  } catch { return false; }
}

async function refreshDiscordMediaUrl(highlight: any) {
  const current = videoUrl(highlight.content);
  if (discordCdnUrlIsFresh(current) || !env.DISCORD_TOKEN || !highlight.discord_channel_id || !highlight.discord_message_id) return current;
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${highlight.discord_channel_id}/messages/${highlight.discord_message_id}`, {
      headers: { authorization: `Bot ${env.DISCORD_TOKEN}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return current;
    const message = await response.json() as { attachments?: Array<{ url?: string; content_type?: string; filename?: string }> };
    const attachment = (message.attachments ?? []).find((item) => item.content_type?.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(item.filename ?? ""));
    if (!attachment?.url) return current;
    const durableUrl = await mirrorHighlightMedia(attachment.url, highlight.league_id, highlight.discord_message_id).catch(() => attachment.url!);
    void supabase.from("rec_highlight_posts").update({ content: durableUrl, updated_at: new Date().toISOString() }).eq("id", highlight.id);
    return durableUrl;
  } catch { return current; }
}

export async function getHub(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const canManageLeague = await assertGuildPermission(guildId, discordId, "co_commissioner").then(() => true).catch(() => false);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);

  const [announcements, headlines, highlights, matchups, myTeam] = await Promise.all([
    supabase.from("rec_hub_announcements").select("id,title,body,season_number,week_number,published_at").eq("league_id", context.leagueId).order("published_at", { ascending: false }).limit(8),
    supabase.from("rec_game_stories").select("id,season,week,headline,body,primary_angle,notes,story_type,roundtable,created_at").eq("league_id", context.leagueId).order("created_at", { ascending: false }).limit(12),
    supabase.from("rec_highlight_posts").select("id,league_id,user_id,team_id,season_number,week_number,season_stage,message_url,content,discord_channel_id,discord_message_id,created_at,user:rec_users(display_name),team:rec_teams(name,abbreviation)").eq("league_id", context.leagueId).order("created_at", { ascending: false }).limit(5),
    getWeeklyH2hGames(guildId),
    Promise.all([getUserMenuProfileByDiscordId(discordId, guildId), getUserSnapshot(discordId, guildId)]).then(([menu, profile]) => ({ ...menu, profile })),
  ]);
  if (announcements.error) throw new ApiError(500, "Failed to load hub announcements.", announcements.error);
  if (headlines.error) throw new ApiError(500, "Failed to load hub headlines.", headlines.error);
  if (highlights.error) throw new ApiError(500, "Failed to load highlights.", highlights.error);

  const storeConfig = await supabase.from("rec_league_configuration").select("coin_economy_enabled,age_resets_enabled,dev_upgrades_enabled,contract_adjustment_purchases_enabled,player_trait_purchases_enabled,attribute_purchases_enabled,legends_enabled,custom_players_enabled").eq("league_id", context.leagueId).maybeSingle();
  if (storeConfig.error) throw new ApiError(500, "Failed to load Hub store configuration.", storeConfig.error);
  const cfg = storeConfig.data ?? {};
  const cfbSeasonOne = context.rec_leagues.game === "cfb_27" && seasonNumber < 2;
  const productConfig = [
    ["age_reset", "Age Reset", "age_resets_enabled", true], ["dev_upgrade", "Dev Upgrade", "dev_upgrades_enabled", true],
    ["contract", "Contract", "contract_adjustment_purchases_enabled", true], ["player_trait", "Player Trait Change", "player_trait_purchases_enabled", true],
    ["attribute", "Attribute Points", "attribute_purchases_enabled", true], ["legend", context.rec_leagues.game === "cfb_27" ? "Campus Legend" : "Legend", "legends_enabled", true],
    ["custom_player", context.rec_leagues.game === "cfb_27" ? "Custom Recruit" : "Custom Player", "custom_players_enabled", true],
  ] as const;

  const ids = (highlights.data ?? []).map((item: any) => item.id);
  const storyIds = (headlines.data ?? []).map((item: any) => item.id);
  const gameIds = (matchups.games ?? []).map((game: any) => game.gameId);
  const reactions = ids.length
    ? await supabase.from("rec_highlight_reactions").select("highlight_post_id,user_id,reaction_key").in("highlight_post_id", ids)
    : { data: [], error: null };
  if (reactions.error) throw new ApiError(500, "Failed to load highlight reactions.", reactions.error);
  const views = ids.length
    ? await supabase.from("rec_highlight_views").select("highlight_post_id").in("highlight_post_id", ids)
    : { data: [], error: null };
  if (views.error) throw new ApiError(500, "Failed to load highlight views.", views.error);
  const [storyReactions, storyComments, gameReactions] = await Promise.all([
    storyIds.length ? supabase.from("rec_story_reactions").select("story_id,user_id,reaction_key").in("story_id", storyIds) : Promise.resolve({ data: [], error: null }),
    storyIds.length ? supabase.from("rec_story_comments").select("story_id").in("story_id", storyIds) : Promise.resolve({ data: [], error: null }),
    gameIds.length ? supabase.from("rec_game_reactions").select("game_id,user_id,reaction_key").in("game_id", gameIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (storyReactions.error || storyComments.error || gameReactions.error) throw new ApiError(500, "Failed to load Hub discussion activity.", storyReactions.error ?? storyComments.error ?? gameReactions.error);

  const hydratedHighlights = await Promise.all(shuffled(highlights.data ?? []).map(async (item: any) => ({ ...item, videoUrl: await refreshDiscordMediaUrl(item) })));

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
    store: {
      enabled: Boolean(cfg.coin_economy_enabled),
      cfbSeasonOneLocked: cfbSeasonOne,
      products: productConfig.filter(([, , flag]) => Boolean((cfg as any)[flag])).map(([type, label, , cfbLocked]) => ({ type, label, locked: cfbSeasonOne && cfbLocked })),
    },
    announcements: announcements.data ?? [],
    headlines: (headlines.data ?? []).map((story: any) => {
      const reactions = (storyReactions.data ?? []).filter((reaction: any) => reaction.story_id === story.id);
      return {
      ...story,
      story_type: story.story_type ?? "game_article",
      roundtable: story.story_type === "headline" ? null : story.roundtable ?? buildRoundtableDiscussion({
        headline: story.headline ?? "League Story",
        body: story.body ?? "League coverage and analysis.",
        notes: Array.isArray(story.notes) ? story.notes : [],
      }),
      reactionCounts: {
        like: reactions.filter((reaction: any) => reaction.reaction_key === "like").length,
        dislike: reactions.filter((reaction: any) => reaction.reaction_key === "dislike").length,
      },
      myReaction: reactions.find((reaction: any) => reaction.user_id === userId)?.reaction_key ?? null,
      commentCount: (storyComments.data ?? []).filter((comment: any) => comment.story_id === story.id).length,
    };}),
    matchups: { ...matchups, games: (matchups.games ?? []).map((game: any) => {
      const reactions = (gameReactions.data ?? []).filter((reaction: any) => reaction.game_id === game.gameId);
      return { ...game, reactionCounts: { like: reactions.filter((reaction: any) => reaction.reaction_key === "like").length, dislike: reactions.filter((reaction: any) => reaction.reaction_key === "dislike").length }, myReaction: reactions.find((reaction: any) => reaction.user_id === userId)?.reaction_key ?? null };
    }) },
    myTeam,
    highlights: hydratedHighlights.map((item: any) => {
      const rows = (reactions.data ?? []).filter((reaction: any) => reaction.highlight_post_id === item.id);
      const counts = Object.fromEntries(HUB_REACTION_KEYS.map((key) => [key, rows.filter((reaction: any) => reaction.reaction_key === key).length]));
      const viewCount = (views.data ?? []).filter((view: any) => view.highlight_post_id === item.id).length;
      return { ...item, viewCount, reactionCounts: counts, myReactions: rows.filter((reaction: any) => reaction.user_id === userId).map((reaction: any) => reaction.reaction_key) };
    }),
  };
}

export async function recordHubHighlightView(input: { guildId: string; discordId: string; highlightId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const highlight = await supabase.from("rec_highlight_posts").select("id").eq("id", input.highlightId).eq("league_id", context.leagueId).maybeSingle();
  if (highlight.error) throw new ApiError(500, "Failed to verify highlight.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight not found.");

  const inserted = await supabase.from("rec_highlight_views").insert({
    id: randomUUID(), highlight_post_id: input.highlightId, user_id: userId, viewed_at: new Date().toISOString(),
  });
  if (inserted.error && inserted.error.code !== "23505") throw new ApiError(500, "Failed to record highlight view.", inserted.error);

  const count = await supabase.from("rec_highlight_views").select("id", { count: "exact", head: true }).eq("highlight_post_id", input.highlightId);
  if (count.error) throw new ApiError(500, "Failed to count highlight views.", count.error);
  return { viewCount: count.count ?? 0 };
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

async function toggleBinaryReaction(input: { table: "rec_story_reactions" | "rec_game_reactions"; foreignKey: "story_id" | "game_id"; targetId: string; userId: string; seasonNumber: number; reactionKey: "like" | "dislike" }) {
  const existing = await supabase.from(input.table).select("id,reaction_key").eq(input.foreignKey, input.targetId).eq("user_id", input.userId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to read reaction.", existing.error);
  if (existing.data?.reaction_key === input.reactionKey) {
    const removed = await supabase.from(input.table).delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "Failed to remove reaction.", removed.error);
  } else if (existing.data) {
    const updated = await supabase.from(input.table).update({ reaction_key: input.reactionKey }).eq("id", existing.data.id);
    if (updated.error) throw new ApiError(500, "Failed to update reaction.", updated.error);
  } else {
    const inserted = await supabase.from(input.table).insert({ id: randomUUID(), [input.foreignKey]: input.targetId, user_id: input.userId, season_number: input.seasonNumber, reaction_key: input.reactionKey, created_at: new Date().toISOString() });
    if (inserted.error) throw new ApiError(500, "Failed to save reaction.", inserted.error);
  }
  return { ok: true };
}

export async function toggleHubStoryReaction(input: { guildId: string; discordId: string; storyId: string; reactionKey: "like" | "dislike" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const story = await supabase.from("rec_game_stories").select("id,season").eq("id", input.storyId).eq("league_id", context.leagueId).maybeSingle();
  if (story.error) throw new ApiError(500, "Failed to verify story.", story.error);
  if (!story.data) throw new ApiError(404, "Story not found.");
  return toggleBinaryReaction({ table: "rec_story_reactions", foreignKey: "story_id", targetId: input.storyId, userId, seasonNumber: Number(story.data.season), reactionKey: input.reactionKey });
}

export async function toggleHubGameReaction(input: { guildId: string; discordId: string; gameId: string; reactionKey: "like" | "dislike" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const game = await supabase.from("rec_games").select("id").eq("id", input.gameId).eq("league_id", context.leagueId).maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to verify game.", game.error);
  if (!game.data) throw new ApiError(404, "Game not found.");
  return toggleBinaryReaction({ table: "rec_game_reactions", foreignKey: "game_id", targetId: input.gameId, userId, seasonNumber: Number(context.rec_leagues.season_number ?? 1), reactionKey: input.reactionKey });
}

export async function listHubStoryComments(input: { guildId: string; storyId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const story = await supabase.from("rec_game_stories").select("id").eq("id", input.storyId).eq("league_id", context.leagueId).maybeSingle();
  if (!story.data) throw new ApiError(404, "Story not found.");
  const comments = await supabase.from("rec_story_comments").select("id,user_id,body,created_at").eq("story_id", input.storyId).order("created_at", { ascending: true }).limit(100);
  if (comments.error) throw new ApiError(500, "Failed to load comments.", comments.error);
  const userIds = [...new Set((comments.data ?? []).map((comment: any) => comment.user_id))];
  const users = userIds.length ? await supabase.from("rec_users").select("id,display_name").in("id", userIds) : { data: [], error: null };
  const names = new Map((users.data ?? []).map((user: any) => [user.id, user.display_name || "REC Member"]));
  return { comments: (comments.data ?? []).map((comment: any) => ({ ...comment, authorName: names.get(comment.user_id) ?? "REC Member" })) };
}

export async function addHubStoryComment(input: { guildId: string; discordId: string; storyId: string; body: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const story = await supabase.from("rec_game_stories").select("id").eq("id", input.storyId).eq("league_id", context.leagueId).maybeSingle();
  if (!story.data) throw new ApiError(404, "Story not found.");
  const inserted = await supabase.from("rec_story_comments").insert({ id: randomUUID(), story_id: input.storyId, user_id: userId, body: input.body.trim(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  if (inserted.error) throw new ApiError(500, "Failed to post comment.", inserted.error);
  return listHubStoryComments({ guildId: input.guildId, storyId: input.storyId });
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

export async function publishHubStory(input: { guildId: string; discordId: string; headline: string; body: string; storyType: "headline" | "article" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const season = Number(context.rec_leagues.season_number ?? 1);
  const week = Number(context.rec_leagues.current_week ?? 1);
  const roundtable = input.storyType === "article"
    ? buildRoundtableDiscussion({ headline: input.headline, body: input.body })
    : null;
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(), league_id: context.leagueId, season, week, game_id: null,
    primary_angle: "commissioner_story", headline: input.headline, body: input.body,
    notes: [], story_type: input.storyType, roundtable, published_by_discord_id: input.discordId,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id").single();
  if (result.error) throw new ApiError(500, "Failed to publish the league story.", result.error);
  return { published: true, id: result.data.id };
}
