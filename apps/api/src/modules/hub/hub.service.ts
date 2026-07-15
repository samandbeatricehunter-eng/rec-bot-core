import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { findCurrentLeagueContext, getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { getWeeklyH2hGames } from "../league-week/advance-results.service.js";
import { getUserMenuProfileByDiscordId, getUserSnapshot } from "../users/user.service.js";
import { mirrorHighlightMedia } from "../highlights/highlights.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { getTeamScheduleManualState } from "../schedule/team-schedule.service.js";
import { buildRoundtableDiscussion } from "./roundtable.js";

export const HUB_REACTION_KEYS = ["like", "dislike", "TOTY", "COTY", "ROTY", "IOTY", "HOTY", "COOKED", "SKILL_ISSUE", "CLIPPED", "NO_SHOT", "GG_ENERGY", "AURA"] as const;
export type HubReactionKey = (typeof HUB_REACTION_KEYS)[number];
const HIGHLIGHT_AWARD_REACTION_KEYS: HubReactionKey[] = ["TOTY", "COTY", "ROTY", "IOTY", "HOTY"];
const HIGHLIGHT_SIDELINE_REACTION_KEYS: HubReactionKey[] = ["COOKED", "SKILL_ISSUE", "CLIPPED", "NO_SHOT", "GG_ENERGY", "AURA"];
const MEDIA_BUCKET = "rec-media";
const MEDIA_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const USER_ARTICLE_PAYOUT = 100;
const INTERVIEW_PAYOUT = 50;
export const STREAM_VIEWER_COOKIE = "rec_stream_viewer";

// Previously a Context x Category x Template cross-product (300 questions) behind two
// cascading selects — but each template only ever referenced one of {context}/{category},
// so the second dropdown filtered the pool without reliably changing the wording the coach
// saw. Collapsed to a single "Topic" selector with a curated, hand-written question list per
// topic — the old five categories (Gameplan, Locker Room, Opponent Talk, Program Identity,
// Pressure) are baked directly into each topic's question set instead of being a live filter.
const INTERVIEW_TOPIC_QUESTIONS = {
  "Pregame": [
    "What does your gameplan have to get right in the first quarter?",
    "How is the locker room carrying itself heading into kickoff?",
    "What's the one thing about this opponent that worries you most?",
    "What does this game say about who your program is right now?",
    "Where do you feel the pressure most heading into this one?",
    "If the headline writes itself after this game, what does it say about your team?",
  ],
  "Postgame": [
    "What did your gameplan get right today?",
    "What was said in the locker room right after the final whistle?",
    "What did this result reveal about the team you just played?",
    "Does this result change how the league should see your program?",
    "Where did the pressure show up the most during that game?",
    "What's the first thing you fix on film this week?",
  ],
  "Rivalry Week": [
    "What's the gameplan wrinkle you've been saving for this rivalry?",
    "How does the locker room's energy change during rivalry week?",
    "What's your honest read on the team across the field this week?",
    "What does beating this rival mean for your program's identity?",
    "How much extra pressure does a rivalry game carry for your staff?",
    "What's the one storyline outsiders are missing about this rivalry?",
  ],
  "Upset Watch": [
    "What's the gameplan that gives you a puncher's chance here?",
    "Is the locker room buying into the upset, or feeling the doubt?",
    "What do people get wrong about the favorite you're facing?",
    "Does an upset here change what your program is capable of?",
    "How are you managing the pressure of being the clear underdog?",
    "What would this upset mean for the rest of your season?",
  ],
  "Playoff Push": [
    "What does the gameplan need to look like down the stretch?",
    "How is the locker room handling the playoff push pressure?",
    "Which team on your remaining schedule worries you most right now?",
    "What does making the playoffs say about your program's trajectory?",
    "Where do you feel the playoff pressure the most right now?",
    "What has to show up first for your team in this playoff push?",
  ],
  "Rebuild": [
    "What's the gameplan priority while you rebuild this roster?",
    "How do you keep a rebuilding locker room believing in the process?",
    "What have you learned watching how other teams around the league rebuild?",
    "What does success look like for your program's identity this season?",
    "How do you handle outside pressure to rebuild faster than you'd like?",
    "What's one thing the league is underestimating about your rebuild?",
  ],
  "Championship Standard": [
    "What does the gameplan look like when the standard is championship or bust?",
    "How does the locker room handle the weight of championship expectations?",
    "Which contender worries you most on the road to a title?",
    "What does it mean for your program's identity to be held to that standard?",
    "How do you manage pressure when anything short of a title is a letdown?",
    "If the headline writes itself after this season, what does it say about your program?",
  ],
  "Recruiting Trail": [
    "What's the recruiting gameplan for closing out this class?",
    "How does the locker room react when a big recruiting commitment lands?",
    "What are other programs saying about your recruiting pitch?",
    "What does your recruiting class say about your program's identity?",
    "How much pressure comes with living up to a big-name recruiting class?",
    "Which position group are you most focused on upgrading through recruiting?",
  ],
  "Transfer Portal": [
    "What's the plan for working the transfer portal this cycle?",
    "How does the locker room handle players entering the portal?",
    "What's your honest read on the players available in the portal right now?",
    "Does the portal era change how you define your program's identity?",
    "How much pressure does portal roster turnover put on your staff?",
    "Which position group are you most likely to address through the portal?",
  ],
  "Coach Spotlight": [
    "What's the gameplan philosophy you lean on more than anything else?",
    "How do you build a locker room culture that lasts beyond one season?",
    "What's the toughest opposing coach you've had to gameplan against?",
    "How would you describe your program's identity in one sentence?",
    "How do you personally handle the pressure of the job week to week?",
    "What does the headline get wrong about you as a coach?",
  ],
} as const satisfies Record<string, readonly string[]>;

export const INTERVIEW_TOPICS = Object.keys(INTERVIEW_TOPIC_QUESTIONS) as Array<keyof typeof INTERVIEW_TOPIC_QUESTIONS>;

export const INTERVIEW_QUESTIONS = INTERVIEW_TOPICS.flatMap((topic) =>
  INTERVIEW_TOPIC_QUESTIONS[topic].map((question, index) => ({
    id: `${topic.toLowerCase().replaceAll(" ", "_")}:${index + 1}`,
    topic,
    question,
  })),
);

async function userIdForDiscord(discordId: string) {
  const result = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load your REC account.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

async function discordIdForUser(userId: string | null | undefined) {
  if (!userId) return null;
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to resolve Discord account.", account.error);
  return account.data?.discord_id ?? null;
}

async function activeAssignment(leagueId: string, userId: string) {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load team assignment.", assignment.error);
  return assignment.data ?? null;
}

function streamWatchPath(streamLogId: string) {
  return `/v1/hub/streams/open/${streamLogId}`;
}

function missingRelation(error: any, tableName: string) {
  return error?.code === "42P01" || JSON.stringify(error ?? {}).includes(tableName);
}

async function currentH2hOpponent(guildId: string, leagueId: string, userId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const games = await supabase
    .from("rec_games")
    .select("id,home_user_id,away_user_id,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (games.error) throw new ApiError(500, "Failed to load this week's opponent.", games.error);
  const game = (games.data ?? []).find((row: any) => row.home_user_id === userId || row.away_user_id === userId);
  if (!game) return null;
  const isHome = game.home_user_id === userId;
  const opponentUserId = isHome ? game.away_user_id : game.home_user_id;
  if (!opponentUserId) return null;
  const opponentTeam = isHome ? game.away_team : game.home_team;
  return {
    gameId: game.id,
    userId: opponentUserId,
    discordId: await discordIdForUser(opponentUserId),
    teamId: isHome ? game.away_team_id : game.home_team_id,
    teamName: opponentTeam?.name ?? opponentTeam?.abbreviation ?? "Opponent",
    teamAbbreviation: opponentTeam?.abbreviation ?? null,
    seasonNumber,
    weekNumber,
  };
}

const CALLOUT_HEADLINE_TEMPLATES = [
  "@{from} Calls Out @{to}",
  "@{from} Has a Message for @{to}",
  "@{from} Sends a Warning to @{to}",
  "@{from} Fires a Shot at @{to}",
  "@{from} Isn't Holding Back Against @{to}",
  "@{from} Puts @{to} on Notice",
  "@{from} Sounds Off on @{to}",
] as const;

/** Handle-style tag for a team in a headline — abbreviation-based, no spaces, so it reads like a social callout. */
function teamHandle(name: string | null | undefined, abbreviation: string | null | undefined) {
  const raw = (abbreviation || name || "Team").replace(/[^a-z0-9]/gi, "");
  return raw || "Team";
}

function buildCalloutHeadline(fromHandle: string, toHandle: string) {
  const template = CALLOUT_HEADLINE_TEMPLATES[Math.floor(Math.random() * CALLOUT_HEADLINE_TEMPLATES.length)];
  return template.replace("{from}", fromHandle).replace("{to}", toHandle);
}

export async function persistMediaImageBuffer(leagueId: string, buffer: Buffer, contentType: string): Promise<string> {
  if (!MEDIA_IMAGE_MIME_TYPES.has(contentType)) throw new ApiError(400, "Unsupported image type.");
  const ext = contentType === "image/jpeg" ? "jpeg" : contentType === "image/webp" ? "webp" : "png";
  const path = `${leagueId}/${randomUUID()}.${ext}`;
  const uploaded = await supabase.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType, cacheControl: "31536000", upsert: false });
  if (uploaded.error) throw new ApiError(500, "Failed to upload media image.", uploaded.error);
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new ApiError(500, "Failed to resolve media image URL.");
  return data.publicUrl;
}

function sanitizeImageUrl(value?: string | null) {
  const url = String(value ?? "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "Article image must be an uploaded URL.");
  return url;
}

async function publishMediaStory(submission: any, discordId: string | null) {
  const roundtable = submission.submission_type === "interview"
    ? (submission.interview_answers ?? []).map((answer: any) => ({
        speaker: "Coach",
        role: answer.question,
        take: answer.answer,
      }))
    : buildRoundtableDiscussion({ headline: submission.title, body: submission.body });
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(),
    league_id: submission.league_id,
    season: submission.season_number,
    week: submission.week_number,
    game_id: submission.game_id ?? null,
    primary_angle: submission.submission_type,
    headline: submission.title,
    body: submission.body,
    notes: [],
    story_type: "article",
    roundtable,
    image_url: submission.image_url ?? null,
    media_kind: submission.submission_type,
    author_user_id: submission.submitter_user_id ?? null,
    author_discord_id: submission.submitter_discord_id ?? discordId,
    source_submission_id: submission.id,
    published_by_discord_id: discordId,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (result.error) throw new ApiError(500, "Failed to publish media story.", result.error);
  return result.data.id as string;
}

async function issueMediaPayout(submission: any) {
  const amount = Number(submission.amount ?? 0);
  if (!amount || !submission.submitter_user_id) return null;
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: submission.submitter_user_id,
    p_amount: amount,
    p_league_id: submission.league_id,
    p_description: submission.submission_type === "interview" ? `Interview payout - Wk ${submission.week_number}` : `Article payout - Wk ${submission.week_number}`,
    p_transaction_type: submission.submission_type === "interview" ? "interview_payout" : "article_payout",
    p_source: "media",
    p_source_reference: { submissionId: submission.id, submissionType: submission.submission_type },
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue media payout.", ledger.error);
  return ledger.data as string;
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

async function loadHubHeadlines(input: { leagueId: string; seasonNumber: number; currentWeek: number; seasonStage: string | null }) {
  const richSelect = "id,season,week,headline,body,image_url,media_kind,author_discord_id,primary_angle,notes,story_type,roundtable,created_at";
  const baseSelect = "id,season,week,headline,body,primary_angle,notes,story_type,roundtable,created_at";
  const stage = String(input.seasonStage ?? "preseason").toLowerCase();
  if (stage === "preseason" || stage === "preseason_training_camp") return { data: [], error: null };

  const applyCurrentWindow = (select: string) => supabase
    .from("rec_game_stories")
    .select(select)
    .eq("league_id", input.leagueId)
    .eq("season", input.seasonNumber)
    .lte("week", input.currentWeek)
    .order("week", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(12);

  const rich = await applyCurrentWindow(richSelect);
  if (!rich.error) return rich;
  const message = JSON.stringify(rich.error);
  if (!message.includes("image_url") && !message.includes("media_kind") && !message.includes("author_discord_id")) return rich;
  const fallback = await applyCurrentWindow(baseSelect);
  if (fallback.error) return fallback;
  return {
    ...fallback,
    data: (fallback.data ?? []).map((story: any) => ({
      ...story,
      image_url: null,
      media_kind: null,
      author_discord_id: null,
    })),
  };
}

export async function getHub(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const canManageLeague = await assertGuildPermission(guildId, discordId, "co_commissioner").then(() => true).catch(() => false);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const seasonStage = context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "preseason";

  const [announcements, headlines, highlights, matchups, myTeam, powerRankings] = await Promise.all([
    supabase.from("rec_hub_announcements").select("id,title,body,season_number,week_number,published_at").eq("league_id", context.leagueId).order("published_at", { ascending: false }).limit(8),
    loadHubHeadlines({ leagueId: context.leagueId, seasonNumber, currentWeek, seasonStage }),
    supabase.from("rec_highlight_posts").select("id,league_id,user_id,team_id,season_number,week_number,season_stage,message_url,content,discord_channel_id,discord_message_id,created_at,user:rec_users(display_name),team:rec_teams(name,abbreviation)").eq("league_id", context.leagueId).eq("season_number", seasonNumber).order("created_at", { ascending: false }),
    getWeeklyH2hGames(guildId),
    Promise.all([getUserMenuProfileByDiscordId(discordId, guildId), getUserSnapshot(discordId, guildId)]).then(([menu, profile]) => ({ ...menu, profile })),
    computePowerRankings(guildId, discordId).catch(() => null),
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
  const currentStreamLogs = await supabase
    .from("rec_stream_compliance_logs")
    .select("id,user_id,team_id,message_url,posted_at,user:rec_users(display_name),team:rec_teams(name,abbreviation)")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", Number(context.rec_leagues.current_week ?? 1))
    .eq("status", "posted")
    .not("message_url", "is", null)
    .order("posted_at", { ascending: false })
    .limit(16);
  if (currentStreamLogs.error) throw new ApiError(500, "Failed to load live streams.", currentStreamLogs.error);
  const streamLogIds = (currentStreamLogs.data ?? []).map((stream: any) => stream.id);
  const [streamViews, streamReactions] = await Promise.all([
    streamLogIds.length ? supabase.from("rec_stream_views").select("stream_log_id").in("stream_log_id", streamLogIds) : Promise.resolve({ data: [], error: null }),
    streamLogIds.length ? supabase.from("rec_stream_reactions").select("stream_log_id,user_id,reaction_key").in("stream_log_id", streamLogIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (streamViews.error && !missingRelation(streamViews.error, "rec_stream_views")) throw new ApiError(500, "Failed to load stream engagement.", streamViews.error);
  if (streamReactions.error && !missingRelation(streamReactions.error, "rec_stream_reactions")) throw new ApiError(500, "Failed to load stream engagement.", streamReactions.error);

  return {
    league: {
      id: context.leagueId,
      name: context.rec_leagues.name,
      game: context.rec_leagues.game,
      seasonNumber,
      weekNumber: currentWeek,
      seasonStage,
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
    powerRankings,
    liveStreams: (currentStreamLogs.data ?? []).map((stream: any) => {
      const streamRows = (streamReactions.data ?? []).filter((reaction: any) => reaction.stream_log_id === stream.id);
      return {
        id: stream.id,
        url: stream.message_url,
        watchPath: streamWatchPath(stream.id),
        postedAt: stream.posted_at,
        user: stream.user ?? null,
        team: stream.team ?? null,
        viewCount: (streamViews.data ?? []).filter((view: any) => view.stream_log_id === stream.id).length,
        reactionCounts: {
          like: streamRows.filter((reaction: any) => reaction.reaction_key === "like").length,
          dislike: streamRows.filter((reaction: any) => reaction.reaction_key === "dislike").length,
        },
        myReaction: streamRows.find((reaction: any) => reaction.user_id === userId)?.reaction_key ?? null,
      };
    }),
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

  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const recent = await supabase
    .from("rec_highlight_views")
    .select("id")
    .eq("highlight_post_id", input.highlightId)
    .eq("user_id", userId)
    .gte("viewed_at", eightHoursAgo)
    .limit(1);
  if (recent.error) throw new ApiError(500, "Failed to check highlight view cooldown.", recent.error);
  if (!recent.data?.length) {
    const inserted = await supabase.from("rec_highlight_views").insert({
      id: randomUUID(), highlight_post_id: input.highlightId, user_id: userId, viewed_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "Failed to record highlight view.", inserted.error);
  }

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
    const mutuallyExclusive = input.reactionKey === "like" || input.reactionKey === "dislike"
      ? ["like", "dislike"]
      : HIGHLIGHT_AWARD_REACTION_KEYS.includes(input.reactionKey)
        ? HIGHLIGHT_AWARD_REACTION_KEYS
        : HIGHLIGHT_SIDELINE_REACTION_KEYS;
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

export async function recordHubStreamView(input: { guildId: string; discordId: string; streamLogId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const stream = await supabase.from("rec_stream_compliance_logs").select("id,season_number,week_number").eq("id", input.streamLogId).eq("league_id", context.leagueId).maybeSingle();
  if (stream.error) throw new ApiError(500, "Failed to verify stream.", stream.error);
  if (!stream.data) throw new ApiError(404, "Stream not found.");

  const existing = await supabase.from("rec_stream_views").select("id").eq("stream_log_id", input.streamLogId).eq("user_id", userId).limit(1);
  if (existing.error) throw new ApiError(500, "Failed to check stream view.", existing.error);
  if (!existing.data?.length) {
    const inserted = await supabase.from("rec_stream_views").insert({
      stream_log_id: input.streamLogId,
      league_id: context.leagueId,
      season_number: Number(stream.data.season_number),
      week_number: Number(stream.data.week_number),
      user_id: userId,
      discord_id: input.discordId,
      viewed_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "Failed to record stream view.", inserted.error);
  }
  const count = await supabase.from("rec_stream_views").select("id", { count: "exact", head: true }).eq("stream_log_id", input.streamLogId);
  if (count.error) throw new ApiError(500, "Failed to count stream views.", count.error);
  return { viewCount: count.count ?? 0 };
}

export async function recordAnonymousStreamView(input: { streamLogId: string; anonymousViewerId: string }) {
  const stream = await supabase
    .from("rec_stream_compliance_logs")
    .select("id,league_id,season_number,week_number,message_url")
    .eq("id", input.streamLogId)
    .maybeSingle();
  if (stream.error) throw new ApiError(500, "Failed to verify stream.", stream.error);
  if (!stream.data?.message_url) throw new ApiError(404, "Stream not found.");

  const existing = await supabase
    .from("rec_stream_views")
    .select("id")
    .eq("stream_log_id", input.streamLogId)
    .eq("anonymous_viewer_id", input.anonymousViewerId)
    .limit(1);
  if (existing.error) throw new ApiError(500, "Failed to check stream view.", existing.error);
  if (!existing.data?.length) {
    const inserted = await supabase.from("rec_stream_views").insert({
      stream_log_id: input.streamLogId,
      league_id: stream.data.league_id,
      season_number: Number(stream.data.season_number),
      week_number: Number(stream.data.week_number),
      anonymous_viewer_id: input.anonymousViewerId,
      viewed_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "Failed to record stream view.", inserted.error);
  }
  return { url: stream.data.message_url as string };
}

export async function toggleHubStreamReaction(input: { guildId: string; discordId: string; streamLogId: string; reactionKey: "like" | "dislike" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const stream = await supabase.from("rec_stream_compliance_logs").select("id,season_number,week_number").eq("id", input.streamLogId).eq("league_id", context.leagueId).maybeSingle();
  if (stream.error) throw new ApiError(500, "Failed to verify stream.", stream.error);
  if (!stream.data) throw new ApiError(404, "Stream not found.");

  const existing = await supabase.from("rec_stream_reactions").select("id,reaction_key").eq("stream_log_id", input.streamLogId).eq("user_id", userId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to read stream reaction.", existing.error);
  if (existing.data?.reaction_key === input.reactionKey) {
    const removed = await supabase.from("rec_stream_reactions").delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "Failed to remove stream reaction.", removed.error);
  } else if (existing.data) {
    const updated = await supabase.from("rec_stream_reactions").update({ reaction_key: input.reactionKey, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
    if (updated.error) throw new ApiError(500, "Failed to update stream reaction.", updated.error);
  } else {
    const inserted = await supabase.from("rec_stream_reactions").insert({
      stream_log_id: input.streamLogId,
      league_id: context.leagueId,
      season_number: Number(stream.data.season_number),
      week_number: Number(stream.data.week_number),
      user_id: userId,
      discord_id: input.discordId,
      reaction_key: input.reactionKey,
    });
    if (inserted.error) throw new ApiError(500, "Failed to save stream reaction.", inserted.error);
  }
  return { ok: true };
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

export async function createCommissionerMediaArticle(input: {
  guildId: string;
  discordId: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  immediatePost?: boolean;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const now = new Date().toISOString();
  const inserted = await supabase.from("rec_media_submissions").insert({
    id: randomUUID(),
    guild_id: input.guildId,
    server_id: context.serverId,
    league_id: context.leagueId,
    season_number: seasonNumber,
    week_number: weekNumber,
    submission_type: "commissioner_article",
    status: input.immediatePost ? "approved" : "scheduled",
    title: input.title.trim(),
    body: input.body.trim(),
    image_url: sanitizeImageUrl(input.imageUrl),
    submitter_discord_id: input.discordId,
    amount: 0,
    publish_after_advance: !input.immediatePost,
    submitted_at: now,
    created_at: now,
    updated_at: now,
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "Failed to save commissioner article.", inserted.error);
  if (!input.immediatePost) return { scheduled: true, id: inserted.data.id };
  const storyId = await publishMediaStory(inserted.data, input.discordId);
  const updated = await supabase.from("rec_media_submissions").update({ status: "published", approved_story_id: storyId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", inserted.data.id);
  if (updated.error) throw new ApiError(500, "Failed to mark article published.", updated.error);
  return { published: true, id: inserted.data.id, storyId };
}

// Called by the web Hub when getHub() 404s with "no league linked" — tells the page
// whether this is a genuinely fresh server (so it can offer First-Time Setup) and
// whether the current viewer is allowed to run it. Deliberately independent of any
// league existing: assertGuildPermission's "commissioner" tier is pure Discord-API
// membership/role/permission-bit checking, so this works before a league is ever
// created (same trust model createLeagueForServer itself already relies on).
export async function getHubBootstrapStatus(guildId: string, discordId: string) {
  const context = await findCurrentLeagueContext(guildId);
  const leagueExists = Boolean(context);
  const canSetup = await assertGuildPermission(guildId, discordId, "commissioner").then(() => true).catch(() => false);
  return { leagueExists, canSetup };
}

// Read-only, self-scoped season schedule for the My Team page — reuses the commissioner
// schedule builder's data shape (results, pending box scores, byes) but resolves the team
// from the caller's own active assignment instead of an arbitrary teamId, so it can sit
// behind a plain "member" permission check instead of co_commissioner.
export async function getMyTeamSchedule(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const assignment = await activeAssignment(context.leagueId, userId);
  if (!assignment?.team_id) throw new ApiError(404, "You don't have a team linked in this league.");
  return getTeamScheduleManualState({ guildId, teamId: assignment.team_id });
}

export async function getHubMediaPortal(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const [article, interview, opponent] = await Promise.all([
    supabase.from("rec_media_submissions").select("id,status").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("submitter_user_id", userId).eq("submission_type", "user_article").neq("status", "denied").maybeSingle(),
    supabase.from("rec_media_submissions").select("id,status").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("submitter_user_id", userId).eq("submission_type", "interview").neq("status", "denied").maybeSingle(),
    currentH2hOpponent(guildId, context.leagueId, userId),
  ]);
  if (article.error || interview.error) throw new ApiError(500, "Failed to load media submission status.", article.error ?? interview.error);
  return {
    questions: INTERVIEW_QUESTIONS,
    limits: {
      articleSubmitted: Boolean(article.data),
      articleStatus: article.data?.status ?? null,
      interviewSubmitted: Boolean(interview.data),
      interviewStatus: interview.data?.status ?? null,
    },
    opponent,
  };
}

export async function submitUserMediaArticle(input: { guildId: string; discordId: string; title: string; body: string; imageUrl?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const assignment = await activeAssignment(context.leagueId, userId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const row = await supabase.from("rec_media_submissions").insert({
    id: randomUUID(), guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId,
    season_number: seasonNumber, week_number: weekNumber, submission_type: "user_article", status: "pending",
    title: input.title.trim(), body: input.body.trim(), image_url: sanitizeImageUrl(input.imageUrl),
    submitter_user_id: userId, submitter_discord_id: input.discordId, team_id: assignment?.team_id ?? null,
    amount: USER_ARTICLE_PAYOUT, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("*").single();
  if (row.error) {
    if (row.error.code === "23505") throw new ApiError(400, "You already submitted an article for this week.");
    throw new ApiError(500, "Failed to submit article.", row.error);
  }
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber,
    queue_type: "media", status: "pending", priority: 1, header: `Article Review: ${input.title.trim()}`,
    summary: `Custom article submitted by <@${input.discordId}> for commissioner review.`,
    requester_user_id: userId, requester_discord_id: input.discordId, team_id: assignment?.team_id ?? null,
    amount: USER_ARTICLE_PAYOUT, source_table: "rec_media_submissions", source_id: row.data.id,
    payload: { submissionType: "user_article", title: input.title.trim(), body: input.body.trim(), imageUrl: sanitizeImageUrl(input.imageUrl) },
  });
  if (inbox.error) throw new ApiError(500, "Failed to create article review notification.", inbox.error);
  return { submitted: true, id: row.data.id };
}

export async function submitInterview(input: {
  guildId: string;
  discordId: string;
  answers: Array<{ questionId: string; question: string; answer: string }>;
  tagOpponent?: boolean;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  if (input.answers.length !== 3) throw new ApiError(400, "Pick exactly 3 interview questions.");
  const validIds = new Set(INTERVIEW_QUESTIONS.map((question) => question.id));
  for (const answer of input.answers) {
    if (!validIds.has(answer.questionId) || !answer.answer.trim()) throw new ApiError(400, "Each interview answer needs a valid question and response.");
  }
  const assignment = await activeAssignment(context.leagueId, userId);
  const opponent = input.tagOpponent ? await currentH2hOpponent(input.guildId, context.leagueId, userId) : null;
  if (input.tagOpponent && !opponent) throw new ApiError(400, "You can only tag an opponent when you have a human H2H game this week.");
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  let title = `Coach Interview: Week ${weekNumber}`;
  if (opponent && assignment?.team_id) {
    const myTeam = await supabase.from("rec_teams").select("name,abbreviation").eq("id", assignment.team_id).maybeSingle();
    const fromHandle = teamHandle(myTeam.data?.name, myTeam.data?.abbreviation);
    const toHandle = teamHandle(opponent.teamName, opponent.teamAbbreviation);
    title = buildCalloutHeadline(fromHandle, toHandle);
  }
  const body = input.answers.map((answer) => `${answer.question}\n${answer.answer.trim()}`).join("\n\n");
  const row = await supabase.from("rec_media_submissions").insert({
    id: randomUUID(), guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId,
    season_number: seasonNumber, week_number: weekNumber, submission_type: "interview", status: "pending",
    title, body, interview_answers: input.answers, submitter_user_id: userId, submitter_discord_id: input.discordId,
    team_id: assignment?.team_id ?? null, tag_opponent: Boolean(input.tagOpponent), opponent_user_id: opponent?.userId ?? null,
    opponent_discord_id: opponent?.discordId ?? null, opponent_team_id: opponent?.teamId ?? null, game_id: opponent?.gameId ?? null,
    amount: INTERVIEW_PAYOUT, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("*").single();
  if (row.error) {
    if (row.error.code === "23505") throw new ApiError(400, "You already submitted an interview for this week.");
    throw new ApiError(500, "Failed to submit interview.", row.error);
  }
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber,
    queue_type: "media", status: "pending", priority: 2, header: "Interview Review",
    summary: `Interview submitted by <@${input.discordId}>${opponent?.discordId ? ` with an opponent callout for <@${opponent.discordId}>` : ""}.`,
    requester_user_id: userId, requester_discord_id: input.discordId, target_user_id: opponent?.userId ?? null, target_discord_id: opponent?.discordId ?? null,
    team_id: assignment?.team_id ?? null, amount: INTERVIEW_PAYOUT, source_table: "rec_media_submissions", source_id: row.data.id,
    payload: { submissionType: "interview", title, answers: input.answers, tagOpponent: Boolean(input.tagOpponent), opponentDiscordId: opponent?.discordId ?? null },
  });
  if (inbox.error) throw new ApiError(500, "Failed to create interview review notification.", inbox.error);
  if (opponent?.discordId) {
    sendDiscordDirectMessage(opponent.discordId, `<@${input.discordId}> called you out in a REC interview. Open /hub to check the latest media.`)
      .catch((error) => console.error("[WARN] Failed to DM tagged opponent:", error));
  }
  return { submitted: true, id: row.data.id };
}

export async function reviewMediaSubmission(input: { guildId: string; reviewId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_media_submissions").select("*").eq("id", input.reviewId).eq("league_id", context.leagueId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load media submission.", existing.error);
  if (!existing.data) throw new ApiError(404, "Media submission not found.");
  if (existing.data.status !== "pending") return { updated: false, reason: `Submission is already ${existing.data.status}.` };
  if (input.action === "deny") {
    const denied = await supabase.from("rec_media_submissions").update({
      status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, denied_reason: input.deniedReason ?? "Denied by commissioner review.",
      reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", input.reviewId);
    if (denied.error) throw new ApiError(500, "Failed to deny media submission.", denied.error);
    await supabase.from("rec_commissioners_inbox").update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: new Date().toISOString(), review_reason: input.deniedReason ?? null, updated_at: new Date().toISOString() }).eq("source_table", "rec_media_submissions").eq("source_id", input.reviewId);
    return { updated: true };
  }
  const storyId = await publishMediaStory(existing.data, input.reviewedByDiscordId);
  const ledgerId = await issueMediaPayout(existing.data);
  const approved = await supabase.from("rec_media_submissions").update({
    status: "published", approved_story_id: storyId, issued_ledger_id: ledgerId, reviewed_by_discord_id: input.reviewedByDiscordId,
    reviewed_at: new Date().toISOString(), published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", input.reviewId);
  if (approved.error) throw new ApiError(500, "Failed to approve media submission.", approved.error);
  await supabase.from("rec_commissioners_inbox").update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("source_table", "rec_media_submissions").eq("source_id", input.reviewId);
  return { updated: true, storyId, amount: Number(existing.data.amount ?? 0) };
}

export async function publishScheduledMediaForAdvance(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await supabase.from("rec_media_submissions").select("*").eq("league_id", context.leagueId).eq("submission_type", "commissioner_article").eq("status", "scheduled");
  if (rows.error) throw new ApiError(500, "Failed to load scheduled media.", rows.error);
  const published: string[] = [];
  for (const row of rows.data ?? []) {
    const storyId = await publishMediaStory(row, row.submitter_discord_id ?? null);
    const updated = await supabase.from("rec_media_submissions").update({ status: "published", approved_story_id: storyId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updated.error) throw new ApiError(500, "Failed to mark scheduled media published.", updated.error);
    published.push(storyId);
  }
  return { publishedCount: published.length, storyIds: published };
}

export async function getHubMatchupSchedule(input: { guildId: string; discordId: string; weekNumber?: number | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const selectedWeek = input.weekNumber ?? currentWeek;
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  let gamesQuery = supabase
    .from("rec_games")
    .select("id,week_number,home_user_id,away_user_id,home_score,away_score,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,conference),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,conference)")
    .eq("league_id", context.leagueId)
    .eq("week_number", selectedWeek);
  if (seasonId) gamesQuery = gamesQuery.eq("season_id", seasonId);
  const [games, weeks, results, streamLogs, streamViewsForWeek, streamReactionsForWeek, assignments, gotwPoll] = await Promise.all([
    gamesQuery,
    supabase.from("rec_games").select("week_number").eq("league_id", context.leagueId).order("week_number", { ascending: true }),
    supabase.from("rec_game_results").select("home_team_id,away_team_id,home_score,away_score,is_tie,winning_team_id,source").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek),
    supabase.from("rec_stream_compliance_logs").select("id,user_id,message_url,posted_at,details").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek).eq("status", "posted").order("posted_at", { ascending: false }),
    supabase.from("rec_stream_views").select("stream_log_id").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek),
    supabase.from("rec_stream_reactions").select("stream_log_id,user_id,reaction_key").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek),
    supabase.from("rec_team_assignments").select("user_id,team:rec_teams(id,name,abbreviation,conference,division),user:rec_users(display_name)").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null),
    supabase.from("rec_game_of_week_polls").select("*").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek).in("status", ["open", "closed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (games.error || weeks.error || results.error || streamLogs.error || assignments.error || gotwPoll.error) throw new ApiError(500, "Failed to load matchup schedule.", games.error ?? weeks.error ?? results.error ?? streamLogs.error ?? assignments.error ?? gotwPoll.error);
  if (streamViewsForWeek.error && !missingRelation(streamViewsForWeek.error, "rec_stream_views")) throw new ApiError(500, "Failed to load stream views.", streamViewsForWeek.error);
  if (streamReactionsForWeek.error && !missingRelation(streamReactionsForWeek.error, "rec_stream_reactions")) throw new ApiError(500, "Failed to load stream reactions.", streamReactionsForWeek.error);
  const poll = gotwPoll.data ?? null;
  const voteRows = poll
    ? await supabase.from("rec_game_of_week_votes").select("selected_team_id,discord_id").eq("poll_id", poll.id)
    : { data: [], error: null };
  if (voteRows.error) throw new ApiError(500, "Failed to load GOTW votes.", voteRows.error);
  const gotwCounts = {
    away: (voteRows.data ?? []).filter((vote: any) => vote.selected_team_id === poll?.away_team_id).length,
    home: (voteRows.data ?? []).filter((vote: any) => vote.selected_team_id === poll?.home_team_id).length,
  };
  const myGotwVote = (voteRows.data ?? []).find((vote: any) => vote.discord_id === input.discordId)?.selected_team_id ?? null;
  const assignmentUserIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))] as string[];
  const accounts = assignmentUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", assignmentUserIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load matchup user names.", accounts.error);
  const accountByUserId = new Map((accounts.data ?? []).map((account: any) => [account.user_id, account]));
  const isSnowflake = (value: unknown) => /^\d{15,}$/.test(String(value ?? ""));
  const displayNameForUser = (row: any) => {
    const account = accountByUserId.get(row.user_id) as any;
    const storedName = row.user?.display_name ?? null;
    // The matchup directory is an account directory, not a guild roster. Use the
    // immutable Discord username instead of a server nickname/global display name.
    // Guard every source against a raw snowflake — accounts can be poisoned with the
    // Discord ID as a placeholder when the live lookup fails at link time.
    if (account?.username && !isSnowflake(account.username)) return account.username;
    if (account?.global_name && !isSnowflake(account.global_name)) return account.global_name;
    if (storedName && !isSnowflake(storedName)) return storedName;
    return "REC Member";
  };
  const usersByConference = new Map<string, any[]>();
  for (const row of assignments.data ?? []) {
    const team = Array.isArray(row.team) ? row.team[0] : row.team;
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    const conference = team?.conference ?? "Independent";
    const list = usersByConference.get(conference) ?? [];
    list.push({ userId: row.user_id, displayName: displayNameForUser({ ...row, user }), teamName: team?.name ?? team?.abbreviation ?? "Team", division: team?.division ?? null });
    usersByConference.set(conference, list);
  }
  const minimumMaxWeek = Math.max(14, currentWeek);
  const weekNumbers = [...new Set<number>([
    ...Array.from({ length: minimumMaxWeek + 1 }, (_, week) => week),
    ...(weeks.data ?? []).map((row: any) => Number(row.week_number)).filter((week: number) => Number.isFinite(week)),
  ])].sort((a: number, b: number) => a - b);
  const resultByTeams = new Map<string, any>();
  for (const result of results.data ?? []) {
    if (result.home_team_id && result.away_team_id) resultByTeams.set(`${result.home_team_id}:${result.away_team_id}`, result);
  }
  const gotwGame = poll ? (games.data ?? []).find((game: any) => game.id === poll.game_id) : null;
  const gotwResult = poll ? resultByTeams.get(`${poll.home_team_id}:${poll.away_team_id}`) ?? null : null;
  const gotwBoxScore = poll?.game_id
    ? await supabase.from("rec_box_score_submissions").select("id,status").eq("game_id", poll.game_id).in("status", ["pending", "approved"]).limit(1).maybeSingle()
    : { data: null, error: null };
  if (gotwBoxScore.error) throw new ApiError(500, "Failed to load GOTW box-score status.", gotwBoxScore.error);
  const gotwHasFinal = Boolean(gotwResult) || Boolean(gotwBoxScore.data) || (gotwGame && (["final", "completed", "played"].includes(String(gotwGame.status ?? "").toLowerCase()) || (gotwGame.home_score != null && gotwGame.away_score != null)));
  const gotwVoteOpen = Boolean(poll && poll.status === "open" && !gotwHasFinal);
  const streamByUser = new Map<string, any>();
  for (const stream of streamLogs.data ?? []) {
    if (stream.user_id && stream.message_url && !streamByUser.has(stream.user_id)) streamByUser.set(stream.user_id, stream);
  }
  const streamEngagement = (stream: any) => {
    const reactions = (streamReactionsForWeek.data ?? []).filter((reaction: any) => reaction.stream_log_id === stream.id);
    return {
      viewCount: (streamViewsForWeek.data ?? []).filter((view: any) => view.stream_log_id === stream.id).length,
      reactionCounts: {
        like: reactions.filter((reaction: any) => reaction.reaction_key === "like").length,
        dislike: reactions.filter((reaction: any) => reaction.reaction_key === "dislike").length,
      },
      myReaction: reactions.find((reaction: any) => reaction.user_id === userId)?.reaction_key ?? null,
    };
  };
  const gameIds = (games.data ?? []).map((game: any) => game.id).filter(Boolean);
  const boxScores = gameIds.length
    ? await supabase.from("rec_box_score_submissions").select("id,game_id,status").in("game_id", gameIds).in("status", ["pending", "approved"])
    : { data: [], error: null };
  if (boxScores.error) throw new ApiError(500, "Failed to load matchup box-score status.", boxScores.error);
  const boxScoreByGameId = new Map<string, any>((boxScores.data ?? []).map((row: any) => [row.game_id, row]));
  return {
    currentWeek,
    selectedWeek,
    weekNumbers,
    usersByConference: [...usersByConference.entries()].map(([conference, users]) => ({ conference, users: users.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName)) })),
    gotw: poll ? {
      pollId: poll.id,
      gameId: poll.game_id,
      status: gotwVoteOpen ? "open" : "closed",
      canVote: gotwVoteOpen,
      awayTeamId: poll.away_team_id,
      homeTeamId: poll.home_team_id,
      awayTeamName: poll.away_team_name,
      homeTeamName: poll.home_team_name,
      awayVotes: gotwCounts.away,
      homeVotes: gotwCounts.home,
      myVote: myGotwVote,
    } : null,
    games: (games.data ?? []).filter((game: any) => game.home_user_id || game.away_user_id).map((game: any) => {
      const result = resultByTeams.get(`${game.home_team?.id}:${game.away_team?.id}`) ?? null;
      const homeScore = result?.home_score ?? game.home_score ?? null;
      const awayScore = result?.away_score ?? game.away_score ?? null;
      const isFinal = Boolean(result) || ["final", "completed", "played"].includes(String(game.status ?? "").toLowerCase()) || (homeScore != null && awayScore != null && selectedWeek < currentWeek);
      const showStreams = !isFinal && game.home_user_id && game.away_user_id;
      const homeStream = showStreams ? streamByUser.get(game.home_user_id) ?? null : null;
      const awayStream = showStreams ? streamByUser.get(game.away_user_id) ?? null : null;
      const boxScore = boxScoreByGameId.get(game.id) ?? null;
      return {
        gameId: game.id,
        weekNumber: Number(game.week_number),
        matchupType: game.home_user_id && game.away_user_id ? "h2h" : game.home_user_id || game.away_user_id ? "human_cpu" : "cpu",
        involvesMe: game.home_user_id === userId || game.away_user_id === userId,
        isGameOfWeek: poll?.game_id === game.id,
        homeTeamName: game.home_team?.name ?? game.home_team?.abbreviation ?? "Home",
        awayTeamName: game.away_team?.name ?? game.away_team?.abbreviation ?? "Away",
        homeConference: game.home_team?.conference ?? null,
        awayConference: game.away_team?.conference ?? null,
        homeScore,
        awayScore,
        isFinal,
        winnerTeamId: result?.winning_team_id ?? null,
        boxScoreSubmissionId: boxScore?.id ?? null,
        boxScoreStatus: boxScore?.status ?? null,
        streams: [
          awayStream ? { side: "away", userId: game.away_user_id, teamName: game.away_team?.name ?? game.away_team?.abbreviation ?? "Away", streamLogId: awayStream.id, url: awayStream.message_url, watchPath: streamWatchPath(awayStream.id), postedAt: awayStream.posted_at ?? null, ...streamEngagement(awayStream) } : null,
          homeStream ? { side: "home", userId: game.home_user_id, teamName: game.home_team?.name ?? game.home_team?.abbreviation ?? "Home", streamLogId: homeStream.id, url: homeStream.message_url, watchPath: streamWatchPath(homeStream.id), postedAt: homeStream.posted_at ?? null, ...streamEngagement(homeStream) } : null,
        ].filter(Boolean),
      };
    }).sort((a: any, b: any) => Number(b.involvesMe) - Number(a.involvesMe) || Number(b.isGameOfWeek) - Number(a.isGameOfWeek) || Number(b.matchupType === "h2h") - Number(a.matchupType === "h2h") || a.awayTeamName.localeCompare(b.awayTeamName)),
  };
}

export async function voteGameOfWeek(input: { guildId: string; discordId: string; pollId: string; selectedTeamId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const poll = await supabase.from("rec_game_of_week_polls").select("*").eq("id", input.pollId).eq("league_id", context.leagueId).maybeSingle();
  if (poll.error) throw new ApiError(500, "Failed to load GOTW poll.", poll.error);
  if (!poll.data) throw new ApiError(404, "GOTW poll not found.");
  if (poll.data.status !== "open") throw new ApiError(400, "GOTW voting is closed.");
  if (![poll.data.away_team_id, poll.data.home_team_id].includes(input.selectedTeamId)) throw new ApiError(400, "Pick one of the GOTW teams.");
  const selectedName = input.selectedTeamId === poll.data.away_team_id ? poll.data.away_team_name : poll.data.home_team_name;
  const voted = await supabase.from("rec_game_of_week_votes").upsert({
    poll_id: input.pollId,
    league_id: context.leagueId,
    season_number: poll.data.season_number,
    week_number: poll.data.week_number,
    user_id: userId,
    discord_id: input.discordId,
    selected_team_id: input.selectedTeamId,
    selected_team_name: selectedName,
    is_correct: null,
    payout_amount: 0,
    voted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "poll_id,discord_id" });
  if (voted.error) throw new ApiError(500, "Failed to save GOTW vote.", voted.error);
  return { voted: true };
}

export async function closeGameOfWeekVoting(input: { guildId: string; pollId: string; closedByDiscordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const closed = await supabase.from("rec_game_of_week_polls").update({ status: "closed", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.pollId).eq("league_id", context.leagueId).eq("status", "open").select("id").maybeSingle();
  if (closed.error) throw new ApiError(500, "Failed to close GOTW voting.", closed.error);
  if (!closed.data) throw new ApiError(400, "GOTW voting is already closed or unavailable.");
  return { closed: true };
}
