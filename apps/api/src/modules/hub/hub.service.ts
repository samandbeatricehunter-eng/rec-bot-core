import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { markGameStarted } from "../scheduling/matchup-scheduling.service.js";
import { postOrUpdateGameAnnouncement } from "../scheduling/game-announcement.service.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { postDiscordChannelMessage, sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { findCurrentLeagueContext, getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { getWeeklyH2hGames } from "../league-week/advance-results.service.js";
import { getUserMenuProfileByDiscordId, getUserSnapshot } from "../users/user.service.js";
import { streamPlaybackUrls } from "../../lib/cloudflare-stream.js";
import { mirrorHighlightMedia } from "../highlights/highlights.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { computeLeagueSos } from "../schedule/sos.service.js";
import { computeUserRatings } from "../league-week/ratings.service.js";
import { getTeamScheduleManualState } from "../schedule/team-schedule.service.js";
import { getLeagueConfigAsDraft } from "../setup/setup.service.js";
import { closeWageringForGame } from "../wagers/wagers.service.js";
import { getH2hHistory } from "../official-records/official-records.service.js";
import { createStreamPayoutReview, deriveStreamMatchupContext, postLeagueChatStreamNotice, postStreamToDiscordChannel } from "../streams/streams.service.js";
import { stageHasScheduledGames, stageLabel } from "@rec/shared";
import { resolveChatAuthor } from "../../lib/chat-identity.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";
import {
  buildInterviewHeadline,
  formatInterviewBody,
  interviewRoundtableLooksLikeQa,
} from "./interview-headlines.js";
import { buildRoundtableDiscussion } from "./roundtable.js";
import { postGeneratedHeadlineToDiscord } from "./story-publishing.js";
import { CFB_TEAM_PRIMARY_COLORS, NFL_TEAM_PRIMARY_COLORS } from "@rec/shared";
import { formatTeamDisplayName, resolveTeamNick, resolveTeamSchool } from "../users/user-profile-stats.service.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { getGameChatMessages, sendGameChatMessage } from "../game-chat/game-chat.service.js";
import { pruneDeadHighlightsOnceDaily } from "../site-home/site-home.service.js";
import { clearDiscordTeamIdentityForUsers } from "../team-ownership/team-ownership.service.js";
import { syncLeagueRecruitingAd } from "../recruiting-board/recruiting-board.service.js";

// A posted stream's link and its "LIVE" tag stay active for 2 hours, then close — no REC
// stream runs longer than that, so anything older is treated as ended for display/watch.
// This is a read-time window only; the compliance log itself is untouched (payouts still count).
const STREAM_LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
function streamLiveSince(): string {
  return new Date(Date.now() - STREAM_LIVE_WINDOW_MS).toISOString();
}

export const HUB_REACTION_KEYS = ["love", "like", "dislike", "poop", "TOTY", "COTY", "ROTY", "IOTY", "HOTY", "MVP_PLAY", "MOSSED", "STEAMROLLER", "FAWKKKK", "SNATCHED", "RIP"] as const;
export type HubReactionKey = (typeof HUB_REACTION_KEYS)[number];
const HIGHLIGHT_AWARD_REACTION_KEYS: HubReactionKey[] = ["TOTY", "COTY", "ROTY", "IOTY", "HOTY", "MVP_PLAY"];
const HIGHLIGHT_SIDELINE_REACTION_KEYS: HubReactionKey[] = ["MOSSED", "STEAMROLLER", "FAWKKKK", "SNATCHED", "RIP"];
const MEDIA_BUCKET = "rec-media";
const MEDIA_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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
  if (result.error) throw new ApiError(500, "We couldn't load your REC account. Please try again.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

async function discordIdForUser(userId: string | null | undefined) {
  if (!userId) return null;
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't load your Discord account. Please try again.", account.error);
  return account.data?.discord_id ?? null;
}

async function activeAssignment(leagueId: string, userId: string) {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("id,team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load your team assignment. Please try again.", assignment.error);
  return assignment.data ?? null;
}

/** Member self-service retire from the Discord hub chrome (mirrors site-leagues retire). */
export async function retireFromHub(guildId: string, discordId: string): Promise<{ ok: true }> {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const canManageLeague = await assertGuildPermission(guildId, discordId, "co_commissioner")
    .then(() => true)
    .catch(() => false);
  if (canManageLeague) {
    throw new ApiError(403, "Commissioners cannot retire here. Use League Mgmt to resign or transfer.");
  }

  const assignment = await activeAssignment(context.leagueId, userId);
  if (!assignment) {
    throw new ApiError(404, "No active team assignment in this league.");
  }

  // End the assignment so the team becomes open (listOpenTeams keys off ended_at is null).
  // Keep the team row; do not delete it.
  const updated = await supabase
    .from("rec_team_assignments")
    .update({
      assignment_status: "unlinked",
      ended_at: new Date().toISOString(),
      user_id: null,
    })
    .eq("id", assignment.id)
    .is("ended_at", null)
    .select("id")
    .maybeSingle();
  if (updated.error) throw new ApiError(500, "We couldn't retire you from this league. Please try again.", updated.error);
  if (!updated.data) throw new ApiError(409, "Could not retire from this league. Try again.");

  const membership = await supabase.from("rec_league_memberships")
    .delete()
    .eq("league_id", context.leagueId)
    .eq("user_id", userId);
  if (membership.error) throw new ApiError(500, "The team was opened, but we couldn't remove league access. Please try again.", membership.error);

  await clearDiscordTeamIdentityForUsers({ leagueId: context.leagueId, guildId, userIds: [userId] });
  await syncLeagueRecruitingAd(context.leagueId);

  return { ok: true };
}

function streamWatchPath(streamLogId: string) {
  return `/v1/hub/streams/open/${streamLogId}`;
}

function detectStreamService(rawUrl: string) {
  const url = String(rawUrl ?? "").trim().toLowerCase();
  if (!url) return null;
  if (url.includes("twitch.tv")) return "twitch";
  if (url.includes("youtu.be") || url.includes("youtube.com")) return "youtube";
  if (url.includes("kick.com")) return "kick";
  return "other";
}

function isPostseasonStage(value: unknown) {
  const stage = String(value ?? "").toLowerCase();
  return (
    stage === "playoffs" ||
    stage === "postseason" ||
    stage === "wildcard" ||
    stage === "divisional" ||
    stage === "conference_championship" ||
    stage === "super_bowl" ||
    stage === "national_championship" ||
    stage === "bowl_season"
  );
}

function missingRelation(error: any, tableName: string) {
  return error?.code === "42P01" || JSON.stringify(error ?? {}).includes(tableName);
}

async function currentH2hOpponent(guildId: string, leagueId: string, userId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  // Every season restarts at week 1, so without a season_id filter this would also match last
  // season's week_number=1 slate once a league is on its second (or later) season.
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const games = await leagueWeekGamesQuery(supabase, { leagueId, seasonId, weekNumber },
    "id,home_user_id,away_user_id,home_team_id,away_team_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr,is_relocated)");
  if (games.error) throw new ApiError(500, "We couldn't load this week's opponent. Please try again.", games.error);
  const game = (games.data ?? []).find((row: any) => row.home_user_id === userId || row.away_user_id === userId);
  if (!game) return null;
  const isHome = game.home_user_id === userId;
  const opponentUserId = isHome ? game.away_user_id : game.home_user_id;
  if (!opponentUserId) return null;
  const opponentTeam = isHome ? game.away_team : game.home_team;
  // A relocated/renamed team's real identity is display_abbr (e.g. "UAF") — the stock
  // abbreviation column ("ULM") still reflects whatever school it replaced.
  const opponentAbbr = (opponentTeam?.display_abbr || opponentTeam?.abbreviation || null) as string | null;
  return {
    gameId: game.id,
    userId: opponentUserId,
    discordId: await discordIdForUser(opponentUserId),
    teamId: isHome ? game.away_team_id : game.home_team_id,
    teamName: opponentTeam?.name ?? opponentAbbr ?? "Opponent",
    teamAbbreviation: opponentAbbr,
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
  if (uploaded.error) throw new ApiError(500, "We couldn't upload that media image. Please try again.", uploaded.error);
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new ApiError(500, "We couldn't finish uploading that media image. Please try again.");
  return data.publicUrl;
}

function sanitizeImageUrl(value?: string | null) {
  const url = String(value ?? "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "Article image must be an uploaded URL.");
  return url;
}

async function publishMediaStory(submission: any, discordId: string | null) {
  const interviewAnswers = (submission.interview_answers ?? []) as Array<{
    questionId?: string;
    question: string;
    answer: string;
  }>;
  const isInterview = submission.submission_type === "interview";
  const body =
    isInterview && interviewAnswers.length
      ? formatInterviewBody(interviewAnswers)
      : String(submission.body ?? "");
  const existingTitle = String(submission.title ?? "").trim();
  // Keep the submit-time title; only replace the known-bad generic portal fallback.
  const publishedHeadline =
    existingTitle && !/^league portal impact$/i.test(existingTitle)
      ? existingTitle
      : isInterview && interviewAnswers.length
        ? buildInterviewHeadline({
            teamName: null,
            mascotOrNick: null,
            answers: interviewAnswers,
            weekNumber: Number(submission.week_number ?? 1),
          })
        : existingTitle || "League Story";
  const roundtable = null;
  const result = await supabase.from("rec_game_stories").insert({
    id: randomUUID(),
    league_id: submission.league_id,
    season: submission.season_number,
    week: submission.week_number,
    game_id: submission.game_id ?? null,
    primary_angle: submission.submission_type,
    headline: publishedHeadline,
    body,
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
  if (result.error) throw new ApiError(500, "We couldn't publish that media story. Please try again.", result.error);
  await postGeneratedHeadlineToDiscord({ leagueId: submission.league_id, storyId: result.data.id, headline: publishedHeadline, body, image_url: submission.image_url ?? undefined });
  return result.data.id as string;
}

async function issueMediaPayout(submission: any) {
  const amount = Number(submission.amount ?? 0);
  if (!amount || !submission.submitter_user_id) return null;
  const credit = await creditOrBacklog({
    leagueId: submission.league_id,
    seasonNumber: submission.season_number,
    userId: submission.submitter_user_id,
    amount,
    description: submission.submission_type === "interview" ? `Interview payout - Wk ${submission.week_number}` : `Article payout - Wk ${submission.week_number}`,
    transactionType: submission.submission_type === "interview" ? "interview_payout" : "article_payout",
    source: "media",
    sourceReference: { submissionId: submission.id, submissionType: submission.submission_type },
  });
  return credit.ledgerId;
}

function videoUrl(content: string | null) {
  if (!content) return null;
  const urls = content.match(/https?:\/\/\S+/gi) ?? [];
  return urls.find((url) => /\.(mp4|mov|webm|mkv)(?:\?|$)/i.test(url)) ?? urls[0] ?? (/^https?:\/\//i.test(content) ? content : null);
}

function streamHighlightPlayback(highlight: any): { videoUrl: string | null; streamUid: string | null; iframeUrl: string | null } {
  const streamUid = highlight.cloudflare_stream_uid ? String(highlight.cloudflare_stream_uid) : null;
  if (streamUid && (highlight.storage_provider === "cloudflare_stream" || highlight.playback_url)) {
    if (highlight.media_status && highlight.media_status !== "ready") {
      return { videoUrl: null, streamUid, iframeUrl: null };
    }
    const urls = streamPlaybackUrls(streamUid);
    return {
      videoUrl: highlight.playback_url ?? urls.hls,
      streamUid,
      iframeUrl: urls.iframe,
    };
  }
  return { videoUrl: null, streamUid: null, iframeUrl: null };
}

function discordCdnUrlIsFresh(url: string | null) {
  if (!url || !url.includes("cdn.discordapp.com")) return Boolean(url);
  try {
    const expiresHex = new URL(url).searchParams.get("ex");
    return !expiresHex || Number.parseInt(expiresHex, 16) * 1000 > Date.now() + 5 * 60_000;
  } catch { return false; }
}

async function refreshDiscordMediaUrl(highlight: any) {
  const streamed = streamHighlightPlayback(highlight);
  if (streamed.streamUid) return streamed.videoUrl;
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
  const richSelect = "id,season,week,season_stage,headline,body,image_url,media_kind,author_discord_id,primary_angle,notes,story_type,roundtable,created_at";
  const baseSelect = "id,season,week,season_stage,headline,body,primary_angle,notes,story_type,roundtable,created_at";
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
  await pruneDeadHighlightsOnceDaily();
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const canManageLeague = await assertGuildPermission(guildId, discordId, "co_commissioner").then(() => true).catch(() => false);
  // "co_commissioner" passes for full commissioners too (see assertGuildPermission's own
  // comment), so canManageLeague alone can't distinguish the two for role-title display —
  // a second, stricter check against "commissioner" resolves which tier actually applies.
  const commissionerTier: "commissioner" | "co_commissioner" | null = !canManageLeague
    ? null
    : await assertGuildPermission(guildId, discordId, "commissioner").then(() => "commissioner" as const).catch(() => "co_commissioner" as const);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const seasonStage = context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "preseason";

  const [announcements, headlines, highlights, matchups, myTeam, powerRankings, sos, userRatings, storeConfig] = await Promise.all([
    // 60 covers a full season's worth of weekly announcements (even with several posts some
    // weeks) so the hub carousel's week-by-week paging has real history to page back through.
    supabase.from("rec_hub_announcements").select("id,title,body,season_number,week_number,published_at").eq("league_id", context.leagueId).eq("season_number", seasonNumber).order("published_at", { ascending: false }).limit(60),
    loadHubHeadlines({ leagueId: context.leagueId, seasonNumber, currentWeek, seasonStage }),
    // Order by the game's own week first (falling back to created_at within a week) so a
    // highlight submitted late for an earlier week slots back into that week's place in the
    // rotation instead of jumping to the front just because it was uploaded recently.
    supabase.from("rec_highlight_posts").select("id,league_id,user_id,team_id,season_number,week_number,season_stage,message_url,content,discord_channel_id,discord_message_id,cloudflare_stream_uid,storage_provider,media_status,playback_url,hub_visible,created_at,user:rec_users(username,display_name),team:rec_teams(name,abbreviation)").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("hub_visible", true).in("media_status", ["ready"]).order("week_number", { ascending: false }).order("created_at", { ascending: false }),
    getWeeklyH2hGames(guildId),
    Promise.all([getUserMenuProfileByDiscordId(discordId, guildId), getUserSnapshot(discordId, guildId)]).then(([menu, profile]) => ({ ...menu, profile })),
    bestEffort("hub.power_rankings", () => computePowerRankings(guildId, discordId), { guildId }).then((v) => v ?? null),
    bestEffort("hub.league_sos", () => computeLeagueSos(guildId, discordId), { guildId }).then((v) => v ?? null),
    bestEffort("hub.user_ratings", () => computeUserRatings(guildId, discordId), { guildId }).then((v) => v ?? null),
    // Independent of every other item in this batch — used only after everything below, but
    // has zero dependency on any of it, so it belongs here instead of a separate round trip.
    supabase.from("rec_league_configuration").select("coin_economy_enabled,age_resets_enabled,dev_upgrades_enabled,contract_adjustment_purchases_enabled,attribute_purchases_enabled,legends_enabled,custom_players_enabled").eq("league_id", context.leagueId).maybeSingle(),
  ]);
  if (announcements.error) throw new ApiError(500, "We couldn't load hub announcements right now. Please try again.", announcements.error);
  if (headlines.error) throw new ApiError(500, "We couldn't load hub headlines right now. Please try again.", headlines.error);
  if (highlights.error) throw new ApiError(500, "We couldn't load highlights right now. Please try again.", highlights.error);
  if (storeConfig.error) throw new ApiError(500, "We couldn't load the Hub store settings. Please try again.", storeConfig.error);
  const cfg = storeConfig.data ?? {};
  const cfbSeasonOne = context.rec_leagues.game === "cfb_27" && seasonNumber < 2;
  const productConfig = [
    ["age_reset", "Age Reset", "age_resets_enabled", true], ["dev_upgrade", "Dev Upgrade", "dev_upgrades_enabled", true],
    ["contract", "Contract", "contract_adjustment_purchases_enabled", true],
    ["attribute", "Attribute Points", "attribute_purchases_enabled", true], ["legend", context.rec_leagues.game === "cfb_27" ? "Campus Legend" : "Legend", "legends_enabled", true],
    ["custom_player", context.rec_leagues.game === "cfb_27" ? "Custom Recruit" : "Custom Player", "custom_players_enabled", true],
  ] as const;

  const ids = (highlights.data ?? []).map((item: any) => item.id);
  const storyIds = (headlines.data ?? []).map((item: any) => item.id);
  const gameIds = (matchups.games ?? []).map((game: any) => game.gameId);
  const [reactions, views, storyReactions, storyComments, gameReactions] = await Promise.all([
    ids.length ? supabase.from("rec_highlight_reactions").select("highlight_post_id,user_id,reaction_key").in("highlight_post_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("rec_highlight_views").select("highlight_post_id").in("highlight_post_id", ids) : Promise.resolve({ data: [], error: null }),
    storyIds.length ? supabase.from("rec_story_reactions").select("story_id,user_id,reaction_key").in("story_id", storyIds) : Promise.resolve({ data: [], error: null }),
    storyIds.length ? supabase.from("rec_story_comments").select("story_id").in("story_id", storyIds) : Promise.resolve({ data: [], error: null }),
    gameIds.length ? supabase.from("rec_game_reactions").select("game_id,user_id,reaction_key").in("game_id", gameIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (reactions.error) throw new ApiError(500, "We couldn't load highlight reactions right now. Please try again.", reactions.error);
  if (views.error) throw new ApiError(500, "We couldn't load highlight views right now. Please try again.", views.error);
  if (storyReactions.error || storyComments.error || gameReactions.error) throw new ApiError(500, "We couldn't load Hub discussion activity. Please try again.", storyReactions.error ?? storyComments.error ?? gameReactions.error);

  // Preserve the query's newest-first ordering so the reel opens on the latest
  // highlight and autoplay continues chronologically toward older clips.
  const [hydratedHighlights, highlightGames, currentStreamLogs] = await Promise.all([
    Promise.all((highlights.data ?? []).map(async (item: any) => {
      const streamed = streamHighlightPlayback(item);
      const videoUrlValue = streamed.streamUid ? streamed.videoUrl : await refreshDiscordMediaUrl(item);
      return {
        ...item,
        videoUrl: videoUrlValue,
        streamUid: streamed.streamUid,
        iframeUrl: streamed.iframeUrl,
      };
    })),
    supabase
      .from("rec_games")
      .select("week_number,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_city,display_nick,is_relocated)")
      .eq("league_id", context.leagueId),
    supabase
      .from("rec_stream_compliance_logs")
      .select("id,user_id,team_id,game_id,message_url,posted_at,user:rec_users(display_name,username),team:rec_teams(name,abbreviation),game:rec_games(home_team_id,away_team_id,home_user_id,away_user_id)")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", Number(context.rec_leagues.current_week ?? 1))
      .eq("status", "posted")
      .not("message_url", "is", null)
      .gte("posted_at", streamLiveSince())
      .is("ended_at", null)
      .order("posted_at", { ascending: false })
      .limit(16),
  ]);
  if (highlightGames.error) throw new ApiError(500, "We couldn't load highlight matchups right now. Please try again.", highlightGames.error);
  if (currentStreamLogs.error) throw new ApiError(500, "We couldn't load live streams right now. Please try again.", currentStreamLogs.error);
  const highlightGameUserIds = [...new Set((highlightGames.data ?? []).flatMap((game: any) => [game.home_user_id, game.away_user_id]).filter(Boolean))];
  const highlightGameUsers = highlightGameUserIds.length
    ? await supabase.from("rec_users").select("id,username,display_name").in("id", highlightGameUserIds)
    : { data: [], error: null };
  if (highlightGameUsers.error) throw new ApiError(500, "We couldn't load highlight matchup participants right now. Please try again.", highlightGameUsers.error);
  const highlightGameUserNameById = new Map<string, string>((highlightGameUsers.data ?? []).map((u: any) => [u.id, String(u.username ?? u.display_name ?? "REC Member")]));
  const highlightMatchupByTeamWeek = new Map<string, { label: string; participants: { away: string; home: string } | null }>();
  const hubTeamName = (team: any, fallback: string) =>
    context.rec_leagues.game === "cfb_27"
      ? resolveTeamSchool(team) ?? team?.name ?? team?.abbreviation ?? fallback
      : formatTeamDisplayName(team) ?? team?.name ?? team?.abbreviation ?? fallback;
  for (const game of highlightGames.data ?? []) {
    const label = `${hubTeamName((game as any).away_team, "Away")} VS ${hubTeamName((game as any).home_team, "Home")}`;
    const participants = game.home_user_id && game.away_user_id
      ? { away: highlightGameUserNameById.get(game.away_user_id) ?? "REC Member", home: highlightGameUserNameById.get(game.home_user_id) ?? "REC Member" }
      : null;
    const entry = { label, participants };
    if (game.away_team_id) highlightMatchupByTeamWeek.set(`${game.week_number}:${game.away_team_id}`, entry);
    if (game.home_team_id) highlightMatchupByTeamWeek.set(`${game.week_number}:${game.home_team_id}`, entry);
  }
  const streamLogIds = (currentStreamLogs.data ?? []).map((stream: any) => stream.id);
  const liveGameTeamIds = [...new Set((currentStreamLogs.data ?? []).flatMap((stream: any) => [stream.game?.home_team_id, stream.game?.away_team_id]).filter(Boolean))];
  const liveGameTeamsRes = liveGameTeamIds.length
    ? await supabase.from("rec_teams").select("id,name,abbreviation,display_city,display_nick,is_relocated").in("id", liveGameTeamIds)
    : { data: [] as any[], error: null };
  if (liveGameTeamsRes.error) throw new ApiError(500, "We couldn't load live-stream team names. Please try again.", liveGameTeamsRes.error);
  const liveGameTeamNameById = new Map<string, string>((liveGameTeamsRes.data ?? []).map((team: any) => [team.id, hubTeamName(team, "Team")]));
  const [streamViews, streamReactions] = await Promise.all([
    streamLogIds.length ? supabase.from("rec_stream_views").select("stream_log_id").in("stream_log_id", streamLogIds) : Promise.resolve({ data: [], error: null }),
    streamLogIds.length ? supabase.from("rec_stream_reactions").select("stream_log_id,user_id,reaction_key").in("stream_log_id", streamLogIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (streamViews.error && !missingRelation(streamViews.error, "rec_stream_views")) throw new ApiError(500, "We couldn't load stream engagement. Please try again.", streamViews.error);
  if (streamReactions.error && !missingRelation(streamReactions.error, "rec_stream_reactions")) throw new ApiError(500, "We couldn't load stream engagement. Please try again.", streamReactions.error);

  return {
    league: {
      id: context.leagueId,
      name: context.rec_leagues.name,
      game: context.rec_leagues.game,
      seasonNumber,
      weekNumber: currentWeek,
      seasonStage,
      fantasyDraftStatus: context.rec_leagues.fantasy_draft_status ?? "not_applicable",
    },
    canManageLeague,
    commissionerTier,
    store: {
      enabled: Boolean(cfg.coin_economy_enabled),
      cfbSeasonOneLocked: cfbSeasonOne,
      // Dev trait progression is earned in-game for CFB, not purchased — hide the tile
      // entirely there rather than showing it locked/enabled like the other products.
      products: productConfig
        .filter(([type]) => !(type === "dev_upgrade" && context.rec_leagues.game === "cfb_27"))
        .filter(([, , flag]) => Boolean((cfg as any)[flag]))
        .map(([type, label, , cfbLocked]) => ({ type, label, locked: cfbSeasonOne && cfbLocked })),
    },
    announcements: announcements.data ?? [],
    headlines: (headlines.data ?? []).map((story: any) => {
      const reactions = (storyReactions.data ?? []).filter((reaction: any) => reaction.story_id === story.id);
      const isInterview =
        story.media_kind === "interview" ||
        /^Coach Interview:/i.test(String(story.headline ?? "")) ||
        interviewRoundtableLooksLikeQa(story.roundtable);
      let headline = story.headline ?? "League Story";
      let body = story.body ?? "League coverage and analysis.";
      let roundtable =
        story.story_type === "headline"
          ? null
          : story.story_type === "game_article" && !story.roundtable
            ? buildRoundtableDiscussion({
                headline,
                body,
                notes: Array.isArray(story.notes) ? story.notes : [],
              })
            : story.roundtable ?? null;
      const existingTakes = Array.isArray(story.roundtable)
        ? story.roundtable.map((p: any) => String(p.take ?? "").trim()).filter(Boolean)
        : [];
      const hasDuplicateTakes =
        existingTakes.length >= 2 && new Set(existingTakes.map((t) => t.toLowerCase())).size < existingTakes.length;
      if (isInterview && (interviewRoundtableLooksLikeQa(story.roundtable) || hasDuplicateTakes)) {
        // Legacy interviews stored Q&A as roundtable, or analyst bank produced duplicate takes.
        const notes = interviewRoundtableLooksLikeQa(story.roundtable)
          ? existingTakes
          : [String(body ?? "")];
        if (/^Coach Interview:/i.test(String(headline)) || /^league portal impact$/i.test(String(headline))) {
          headline = buildInterviewHeadline({
            teamName: "League",
            answers: notes.map((take: string) => ({ question: "Interview", answer: take })),
            weekNumber: Number(story.week ?? currentWeek),
          });
        }
        roundtable = buildRoundtableDiscussion({ headline, body, notes });
      }
      return {
      ...story,
      headline,
      body,
      story_type: story.story_type ?? "game_article",
      roundtable,
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
    sos,
    userRatings,
    liveStreams: (currentStreamLogs.data ?? []).map((stream: any) => {
      const streamRows = (streamReactions.data ?? []).filter((reaction: any) => reaction.stream_log_id === stream.id);
      const game = stream.game ?? null;
      return {
        id: stream.id,
        url: stream.message_url,
        watchPath: streamWatchPath(stream.id),
        postedAt: stream.posted_at,
        user: stream.user ?? null,
        team: stream.team ?? null,
        awayTeamName: game ? liveGameTeamNameById.get(game.away_team_id) ?? "Away" : null,
        homeTeamName: game ? liveGameTeamNameById.get(game.home_team_id) ?? "Home" : null,
        matchupLabel: game ? (game.home_user_id && game.away_user_id ? "H2H" : "CPU") : null,
        viewCount: (streamViews.data ?? []).filter((view: any) => view.stream_log_id === stream.id).length,
        reactionCounts: {
          like: streamRows.filter((reaction: any) => reaction.reaction_key === "like").length,
          dislike: streamRows.filter((reaction: any) => reaction.reaction_key === "dislike").length,
        },
        myReaction: streamRows.find((reaction: any) => reaction.user_id === userId)?.reaction_key ?? null,
      };
    }),
    myTeam,
    highlights: hydratedHighlights
      .filter((item: any) => Boolean(item.iframeUrl || item.videoUrl))
      .map((item: any) => {
      const rows = (reactions.data ?? []).filter((reaction: any) => reaction.highlight_post_id === item.id);
      const counts = Object.fromEntries(HUB_REACTION_KEYS.map((key) => [key, rows.filter((reaction: any) => reaction.reaction_key === key).length]));
      const viewCount = (views.data ?? []).filter((view: any) => view.highlight_post_id === item.id).length;
      const matchup = item.team_id && item.week_number != null
        ? highlightMatchupByTeamWeek.get(`${item.week_number}:${item.team_id}`)
        : undefined;
      return {
        ...item,
        matchupLabel: matchup?.label ?? null,
        matchupParticipants: matchup?.participants ?? null,
        viewCount,
        reactionCounts: counts,
        myReactions: rows.filter((reaction: any) => reaction.user_id === userId).map((reaction: any) => reaction.reaction_key),
      };
    }),
  };
}

export async function recordHubHighlightView(input: { guildId: string; discordId: string; highlightId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const highlight = await supabase.from("rec_highlight_posts").select("id").eq("id", input.highlightId).eq("league_id", context.leagueId).maybeSingle();
  if (highlight.error) throw new ApiError(500, "We couldn't verify that highlight. Please try again.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight not found.");

  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const recent = await supabase
    .from("rec_highlight_views")
    .select("id")
    .eq("highlight_post_id", input.highlightId)
    .eq("user_id", userId)
    .gte("viewed_at", eightHoursAgo)
    .limit(1);
  if (recent.error) throw new ApiError(500, "We couldn't check the highlight view cooldown. Please try again.", recent.error);
  if (!recent.data?.length) {
    const inserted = await supabase.from("rec_highlight_views").insert({
      id: randomUUID(), highlight_post_id: input.highlightId, user_id: userId, viewed_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "We couldn't record that highlight view. Please try again.", inserted.error);
  }

  const count = await supabase.from("rec_highlight_views").select("id", { count: "exact", head: true }).eq("highlight_post_id", input.highlightId);
  if (count.error) throw new ApiError(500, "We couldn't count highlight views. Please try again.", count.error);
  return { viewCount: count.count ?? 0 };
}

export async function toggleHubHighlightReaction(input: { guildId: string; discordId: string; highlightId: string; reactionKey: HubReactionKey }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const highlight = await supabase.from("rec_highlight_posts").select("id,user_id").eq("id", input.highlightId).eq("league_id", context.leagueId).maybeSingle();
  if (highlight.error) throw new ApiError(500, "We couldn't verify that highlight. Please try again.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight not found.");

  if (
    HIGHLIGHT_AWARD_REACTION_KEYS.includes(input.reactionKey) &&
    String(highlight.data.user_id) === String(userId)
  ) {
    throw new ApiError(400, "You can't nominate your own highlight for Play of the Year.");
  }

  const existing = await supabase.from("rec_highlight_reactions").select("id").eq("highlight_post_id", input.highlightId).eq("user_id", userId).eq("reaction_key", input.reactionKey).maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't load that reaction. Please try again.", existing.error);
  if (existing.data) {
    const removed = await supabase.from("rec_highlight_reactions").delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "We couldn't remove that reaction. Please try again.", removed.error);
  } else {
    const mutuallyExclusive = ["love", "like", "dislike", "poop"].includes(input.reactionKey)
      ? ["love", "like", "dislike", "poop"]
      : HIGHLIGHT_AWARD_REACTION_KEYS.includes(input.reactionKey)
        ? HIGHLIGHT_AWARD_REACTION_KEYS
        : HIGHLIGHT_SIDELINE_REACTION_KEYS;
    const cleared = await supabase.from("rec_highlight_reactions").delete().eq("highlight_post_id", input.highlightId).eq("user_id", userId).in("reaction_key", mutuallyExclusive);
    if (cleared.error) throw new ApiError(500, "We couldn't update that reaction. Please try again.", cleared.error);
    const inserted = await supabase.from("rec_highlight_reactions").insert({ id: randomUUID(), highlight_post_id: input.highlightId, user_id: userId, reaction_key: input.reactionKey, created_at: new Date().toISOString() });
    if (inserted.error) throw new ApiError(500, "We couldn't save that reaction. Please try again.", inserted.error);
  }
  return { ok: true };
}

async function toggleBinaryReaction(input: { table: "rec_story_reactions" | "rec_game_reactions"; foreignKey: "story_id" | "game_id"; targetId: string; userId: string; seasonNumber: number; reactionKey: "like" | "dislike" }) {
  const existing = await supabase.from(input.table).select("id,reaction_key").eq(input.foreignKey, input.targetId).eq("user_id", input.userId).maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't load that reaction. Please try again.", existing.error);
  if (existing.data?.reaction_key === input.reactionKey) {
    const removed = await supabase.from(input.table).delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "We couldn't remove that reaction. Please try again.", removed.error);
  } else if (existing.data) {
    const updated = await supabase.from(input.table).update({ reaction_key: input.reactionKey }).eq("id", existing.data.id);
    if (updated.error) throw new ApiError(500, "We couldn't update that reaction. Please try again.", updated.error);
  } else {
    const inserted = await supabase.from(input.table).insert({ id: randomUUID(), [input.foreignKey]: input.targetId, user_id: input.userId, season_number: input.seasonNumber, reaction_key: input.reactionKey, created_at: new Date().toISOString() });
    if (inserted.error) throw new ApiError(500, "We couldn't save that reaction. Please try again.", inserted.error);
  }
  return { ok: true };
}

export async function toggleHubStoryReaction(input: { guildId: string; discordId: string; storyId: string; reactionKey: "like" | "dislike" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const story = await supabase.from("rec_game_stories").select("id,season").eq("id", input.storyId).eq("league_id", context.leagueId).maybeSingle();
  if (story.error) throw new ApiError(500, "We couldn't verify that story. Please try again.", story.error);
  if (!story.data) throw new ApiError(404, "Story not found.");
  return toggleBinaryReaction({ table: "rec_story_reactions", foreignKey: "story_id", targetId: input.storyId, userId, seasonNumber: Number(story.data.season), reactionKey: input.reactionKey });
}

export async function toggleHubGameReaction(input: {
  guildId: string;
  discordId: string;
  gameId: string;
  reactionKey: "love" | "like" | "goty" | "dislike" | "poop";
  comment?: string | null;
  mode?: "toggle" | "set" | "clear";
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const game = await supabase.from("rec_games").select("id").eq("id", input.gameId).eq("league_id", context.leagueId).maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't verify that game. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Game not found.");

  const mode = input.mode ?? "toggle";
  const comment = input.comment == null ? null : String(input.comment).trim().slice(0, 280) || null;
  const seasonNumber = Number(context.rec_leagues.season_number ?? 1);
  const existing = await supabase
    .from("rec_game_reactions")
    .select("id,comment")
    .eq("game_id", input.gameId)
    .eq("user_id", userId)
    .eq("reaction_key", input.reactionKey)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't load that reaction. Please try again.", existing.error);

  if (input.reactionKey === "goty" && mode === "set") {
    if (existing.data) {
      const updated = await supabase
        .from("rec_game_reactions")
        .update({ comment })
        .eq("id", existing.data.id);
      if (updated.error) throw new ApiError(500, "We couldn't update that GOTY nomination. Please try again.", updated.error);
    } else {
      const inserted = await supabase.from("rec_game_reactions").insert({
        id: randomUUID(),
        game_id: input.gameId,
        user_id: userId,
        season_number: seasonNumber,
        reaction_key: "goty",
        comment,
        created_at: new Date().toISOString(),
      });
      if (inserted.error) throw new ApiError(500, "We couldn't save that GOTY nomination. Please try again.", inserted.error);
    }
    return { ok: true as const, myReactions: ["goty"] as const, myGotyComment: comment };
  }

  if (input.reactionKey === "goty" && mode === "clear") {
    if (existing.data) {
      const removed = await supabase.from("rec_game_reactions").delete().eq("id", existing.data.id);
      if (removed.error) throw new ApiError(500, "We couldn't remove that GOTY nomination. Please try again.", removed.error);
    }
    return { ok: true as const, myReactions: [] as const, myGotyComment: null };
  }

  if (existing.data) {
    const removed = input.reactionKey === "goty"
      ? await supabase.from("rec_game_reactions").delete().eq("id", existing.data.id)
      : await supabase
        .from("rec_game_reactions")
        .delete()
        .eq("game_id", input.gameId)
        .eq("user_id", userId)
        .in("reaction_key", ["love", "like", "dislike", "poop"]);
    if (removed.error) throw new ApiError(500, "We couldn't remove that reaction. Please try again.", removed.error);
  } else {
    if (input.reactionKey !== "goty") {
      const cleared = await supabase
        .from("rec_game_reactions")
        .delete()
        .eq("game_id", input.gameId)
        .eq("user_id", userId)
        .in("reaction_key", ["love", "like", "dislike", "poop"]);
      if (cleared.error) throw new ApiError(500, "We couldn't update that reaction. Please try again.", cleared.error);
    }
    const inserted = await supabase.from("rec_game_reactions").insert({
      id: randomUUID(),
      game_id: input.gameId,
      user_id: userId,
      season_number: seasonNumber,
      reaction_key: input.reactionKey,
      comment: input.reactionKey === "goty" ? comment : null,
      created_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "We couldn't save that reaction. Please try again.", inserted.error);
  }
  return { ok: true as const };
}

export async function recordHubStreamView(input: { guildId: string; discordId: string; streamLogId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const stream = await supabase.from("rec_stream_compliance_logs").select("id,season_number,week_number").eq("id", input.streamLogId).eq("league_id", context.leagueId).maybeSingle();
  if (stream.error) throw new ApiError(500, "We couldn't verify that stream. Please try again.", stream.error);
  if (!stream.data) throw new ApiError(404, "Stream not found.");

  const existing = await supabase.from("rec_stream_views").select("id").eq("stream_log_id", input.streamLogId).eq("user_id", userId).limit(1);
  if (existing.error) throw new ApiError(500, "We couldn't check that stream view. Please try again.", existing.error);
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
    if (inserted.error) throw new ApiError(500, "We couldn't record that stream view. Please try again.", inserted.error);
  }
  const count = await supabase.from("rec_stream_views").select("id", { count: "exact", head: true }).eq("stream_log_id", input.streamLogId);
  if (count.error) throw new ApiError(500, "We couldn't count stream views. Please try again.", count.error);
  return { viewCount: count.count ?? 0 };
}

export async function recordAnonymousStreamView(input: { streamLogId: string; anonymousViewerId: string }) {
  const stream = await supabase
    .from("rec_stream_compliance_logs")
    .select("id,league_id,season_number,week_number,message_url")
    .eq("id", input.streamLogId)
    .maybeSingle();
  if (stream.error) throw new ApiError(500, "We couldn't verify that stream. Please try again.", stream.error);
  if (!stream.data?.message_url) throw new ApiError(404, "Stream not found.");

  const existing = await supabase
    .from("rec_stream_views")
    .select("id")
    .eq("stream_log_id", input.streamLogId)
    .eq("anonymous_viewer_id", input.anonymousViewerId)
    .limit(1);
  if (existing.error) throw new ApiError(500, "We couldn't check that stream view. Please try again.", existing.error);
  if (!existing.data?.length) {
    const inserted = await supabase.from("rec_stream_views").insert({
      stream_log_id: input.streamLogId,
      league_id: stream.data.league_id,
      season_number: Number(stream.data.season_number),
      week_number: Number(stream.data.week_number),
      anonymous_viewer_id: input.anonymousViewerId,
      viewed_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "We couldn't record that stream view. Please try again.", inserted.error);
  }
  return { url: stream.data.message_url as string };
}

export async function toggleHubStreamReaction(input: { guildId: string; discordId: string; streamLogId: string; reactionKey: "like" | "dislike" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const stream = await supabase.from("rec_stream_compliance_logs").select("id,season_number,week_number").eq("id", input.streamLogId).eq("league_id", context.leagueId).maybeSingle();
  if (stream.error) throw new ApiError(500, "We couldn't verify that stream. Please try again.", stream.error);
  if (!stream.data) throw new ApiError(404, "Stream not found.");

  const existing = await supabase.from("rec_stream_reactions").select("id,reaction_key").eq("stream_log_id", input.streamLogId).eq("user_id", userId).maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't read stream reaction. Please try again.", existing.error);
  if (existing.data?.reaction_key === input.reactionKey) {
    const removed = await supabase.from("rec_stream_reactions").delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "We couldn't remove that stream reaction. Please try again.", removed.error);
  } else if (existing.data) {
    const updated = await supabase.from("rec_stream_reactions").update({ reaction_key: input.reactionKey, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
    if (updated.error) throw new ApiError(500, "We couldn't update that stream reaction. Please try again.", updated.error);
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
    if (inserted.error) throw new ApiError(500, "We couldn't save that stream reaction. Please try again.", inserted.error);
  }
  return { ok: true };
}

export async function listHubStoryComments(input: { guildId: string; storyId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const story = await supabase.from("rec_game_stories").select("id").eq("id", input.storyId).eq("league_id", context.leagueId).maybeSingle();
  if (!story.data) throw new ApiError(404, "Story not found.");
  const comments = await supabase.from("rec_story_comments").select("id,user_id,body,created_at").eq("story_id", input.storyId).order("created_at", { ascending: true }).limit(100);
  if (comments.error) throw new ApiError(500, "We couldn't load comments right now. Please try again.", comments.error);
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
  if (inserted.error) throw new ApiError(500, "We couldn't post that comment. Please try again.", inserted.error);
  return listHubStoryComments({ guildId: input.guildId, storyId: input.storyId });
}

export async function recordHubAnnouncement(input: { guildId: string; title: string; body: string; discordChannelId?: string | null; discordMessageId?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);

  // Every hub announcement (automated advance summary or a commissioner's manual post)
  // mirrors to the guild's configured Announcements channel with the exact same title/body
  // shown on the site/app, so Discord members see the same news the hub does.
  const channelId = input.discordChannelId ?? (context.routes?.announcements_channel_id as string | null | undefined) ?? null;
  let messageId = input.discordMessageId ?? null;
  if (channelId && !messageId) {
    const sent = await postDiscordChannelMessage(channelId, {
      embeds: [{ title: input.title, color: 0xd9a521, description: input.body.slice(0, 4096) }],
    }).catch((err) => {
      console.error("[ERROR] Failed to post hub announcement to Discord (non-fatal):", err);
      return null;
    });
    messageId = sent?.id ?? null;
  }

  const result = await supabase.from("rec_hub_announcements").insert({
    id: randomUUID(), league_id: context.leagueId, title: input.title, body: input.body,
    season_number: Number(context.rec_leagues.season_number ?? 1), week_number: Number(context.rec_leagues.current_week ?? 1),
    discord_channel_id: channelId, discord_message_id: messageId,
    published_at: new Date().toISOString(), created_at: new Date().toISOString(),
  });
  if (result.error) throw new ApiError(500, "We couldn't save that hub announcement. Please try again.", result.error);
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
  if (result.error) throw new ApiError(500, "We couldn't publish that league story. Please try again.", result.error);
  await postGeneratedHeadlineToDiscord({ leagueId: context.leagueId, storyId: result.data.id, headline: input.headline, body: input.body });
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
  if (inserted.error) throw new ApiError(500, "We couldn't save that commissioner article. Please try again.", inserted.error);
  if (!input.immediatePost) return { scheduled: true, id: inserted.data.id };
  const storyId = await publishMediaStory(inserted.data, input.discordId);
  const updated = await supabase.from("rec_media_submissions").update({ status: "published", approved_story_id: storyId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", inserted.data.id);
  if (updated.error) throw new ApiError(500, "We couldn't mark that article as published. Please try again.", updated.error);
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

// Wallet card's "View Transactions" modal — most-recent N ledger rows regardless of age,
// unlike the Financial Profile panel's last30Days.transactions (a date window, not a count).
export async function getMyRecentTransactions(guildId: string, discordId: string, limit = 50) {
  const context = await getCurrentLeagueContext(guildId);
  const userId = await userIdForDiscord(discordId);
  const { data, error } = await supabase
    .from("rec_dollar_ledger")
    .select("id,amount,transaction_type,description,created_at")
    .eq("user_id", userId)
    .eq("league_id", context.leagueId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw new ApiError(500, "We couldn't load recent transactions right now. Please try again.", error);
  return {
    transactions: (data ?? []).map((row: any) => ({
      id: row.id,
      amount: Number(row.amount ?? 0),
      transactionType: row.transaction_type ?? null,
      description: row.description ?? null,
      createdAt: row.created_at,
    })),
  };
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
  if (article.error || interview.error) throw new ApiError(500, "We couldn't load media submission status. Please try again.", article.error ?? interview.error);
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
    amount: (await getGlobalEconomyConfig()).submissions.article, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("*").single();
  if (row.error) {
    if (row.error.code === "23505") throw new ApiError(400, "You already submitted an article for this week.");
    throw new ApiError(500, "We couldn't submit that article. Please try again.", row.error);
  }
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber,
    queue_type: "media", status: "pending", priority: 1, header: `Article Review: ${input.title.trim()}`,
    summary: `Custom article submitted by <@${input.discordId}> for commissioner review.`,
    requester_user_id: userId, requester_discord_id: input.discordId, team_id: assignment?.team_id ?? null,
    amount: (await getGlobalEconomyConfig()).submissions.article, source_table: "rec_media_submissions", source_id: row.data.id,
    payload: { submissionType: "user_article", title: input.title.trim(), body: input.body.trim(), imageUrl: sanitizeImageUrl(input.imageUrl) },
  });
  if (inbox.error) throw new ApiError(500, "We couldn't create the article review notification. Please try again.", inbox.error);
  void notifyLeagueCommissionersOfPendingItem(context.leagueId);
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
  let teamName: string | null = null;
  let mascotOrNick: string | null = null;
  if (assignment?.team_id) {
    const myTeam = await supabase
      .from("rec_teams")
      .select("name,abbreviation,display_abbr,display_nick,display_city,is_relocated")
      .eq("id", assignment.team_id)
      .maybeSingle();
    teamName = myTeam.data?.name ?? null;
    mascotOrNick =
      (myTeam.data?.is_relocated && myTeam.data?.display_nick
        ? myTeam.data.display_nick
        : myTeam.data?.display_nick) ??
      teamHandle(myTeam.data?.name, myTeam.data?.display_abbr || myTeam.data?.abbreviation);
  }
  let title = buildInterviewHeadline({
    teamName,
    mascotOrNick,
    answers: input.answers,
    weekNumber,
  });
  if (opponent && assignment?.team_id) {
    const fromHandle = teamHandle(teamName, null);
    const toHandle = teamHandle(opponent.teamName, opponent.teamAbbreviation);
    title = buildCalloutHeadline(fromHandle, toHandle);
  }
  const body = formatInterviewBody(input.answers);
  const row = await supabase.from("rec_media_submissions").insert({
    id: randomUUID(), guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId,
    season_number: seasonNumber, week_number: weekNumber, submission_type: "interview", status: "pending",
    title, body, interview_answers: input.answers, submitter_user_id: userId, submitter_discord_id: input.discordId,
    team_id: assignment?.team_id ?? null, tag_opponent: Boolean(input.tagOpponent), opponent_user_id: opponent?.userId ?? null,
    opponent_discord_id: opponent?.discordId ?? null, opponent_team_id: opponent?.teamId ?? null, game_id: opponent?.gameId ?? null,
    amount: (await getGlobalEconomyConfig()).submissions.interview, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("*").single();
  if (row.error) {
    if (row.error.code === "23505") throw new ApiError(400, "You already submitted an interview for this week.");
    throw new ApiError(500, "We couldn't submit that interview. Please try again.", row.error);
  }
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, server_id: context.serverId, league_id: context.leagueId, season_number: seasonNumber, week_number: weekNumber,
    queue_type: "media", status: "pending", priority: 2, header: "Interview Review",
    summary: `Interview submitted by <@${input.discordId}>${opponent?.discordId ? ` with an opponent callout for <@${opponent.discordId}>` : ""}.`,
    requester_user_id: userId, requester_discord_id: input.discordId, target_user_id: opponent?.userId ?? null, target_discord_id: opponent?.discordId ?? null,
    team_id: assignment?.team_id ?? null, amount: (await getGlobalEconomyConfig()).submissions.interview, source_table: "rec_media_submissions", source_id: row.data.id,
    payload: { submissionType: "interview", title, answers: input.answers, tagOpponent: Boolean(input.tagOpponent), opponentDiscordId: opponent?.discordId ?? null },
  });
  if (inbox.error) throw new ApiError(500, "We couldn't create the interview review notification. Please try again.", inbox.error);
  void notifyLeagueCommissionersOfPendingItem(context.leagueId);
  if (opponent?.discordId) {
    sendDiscordDirectMessage(opponent.discordId, `<@${input.discordId}> called you out in a REC interview. Run /app to check the latest media.`)
      .catch((error) => console.error("[WARN] Failed to DM tagged opponent:", error));
  }
  return { submitted: true, id: row.data.id };
}

export async function reviewMediaSubmission(input: { guildId: string; reviewId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_media_submissions").select("*").eq("id", input.reviewId).eq("league_id", context.leagueId).maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't load that media submission. Please try again.", existing.error);
  if (!existing.data) throw new ApiError(404, "Media submission not found.");
  if (existing.data.status !== "pending") return { updated: false, reason: `Submission is already ${existing.data.status}.` };
  if (input.action === "deny") {
    const denied = await supabase.from("rec_media_submissions").update({
      status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, denied_reason: input.deniedReason ?? "Denied by commissioner review.",
      reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", input.reviewId);
    if (denied.error) throw new ApiError(500, "We couldn't deny that media submission. Please try again.", denied.error);
    await supabase.from("rec_commissioners_inbox").update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: new Date().toISOString(), review_reason: input.deniedReason ?? null, updated_at: new Date().toISOString() }).eq("source_table", "rec_media_submissions").eq("source_id", input.reviewId);
    return { updated: true };
  }
  const storyId = await publishMediaStory(existing.data, input.reviewedByDiscordId);
  const ledgerId = await issueMediaPayout(existing.data);
  const approved = await supabase.from("rec_media_submissions").update({
    status: "published", approved_story_id: storyId, issued_ledger_id: ledgerId, reviewed_by_discord_id: input.reviewedByDiscordId,
    reviewed_at: new Date().toISOString(), published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", input.reviewId);
  if (approved.error) throw new ApiError(500, "We couldn't approve that media submission. Please try again.", approved.error);
  await supabase.from("rec_commissioners_inbox").update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("source_table", "rec_media_submissions").eq("source_id", input.reviewId);
  return { updated: true, storyId, amount: Number(existing.data.amount ?? 0) };
}

export async function publishScheduledMediaForAdvance(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const rows = await supabase.from("rec_media_submissions").select("*").eq("league_id", context.leagueId).eq("submission_type", "commissioner_article").eq("status", "scheduled");
  if (rows.error) throw new ApiError(500, "We couldn't load scheduled media right now. Please try again.", rows.error);
  const published: string[] = [];
  for (const row of rows.data ?? []) {
    const storyId = await publishMediaStory(row, row.submitter_discord_id ?? null);
    const updated = await supabase.from("rec_media_submissions").update({ status: "published", approved_story_id: storyId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updated.error) throw new ApiError(500, "We couldn't mark that scheduled media as published. Please try again.", updated.error);
    published.push(storyId);
  }
  return { publishedCount: published.length, storyIds: published };
}

export async function getHubMatchupSchedule(input: { guildId: string; discordId: string; weekNumber?: number | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const isCfb = context.rec_leagues.game === "cfb_27";
  const universityName = (team: any, fallback: string) =>
    isCfb ? resolveTeamSchool(team) ?? team?.name ?? team?.abbreviation ?? fallback : formatTeamDisplayName(team) ?? team?.name ?? team?.abbreviation ?? fallback;
  const mascotName = (team: any, fallback: string) =>
    isCfb ? resolveTeamNick(team) : universityName(team, fallback);
  const userId = await userIdForDiscord(input.discordId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const selectedWeek = input.weekNumber ?? currentWeek;
  const seasonStage = context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "preseason";
  // Once the league has finished its championship game it moves into the dynasty offseason
  // pipeline (End of Season Recap, Transfer Portal, etc.) — no rec_games rows are scheduled
  // for that stage, so skip the games query entirely and tell the client there's no slate to
  // show instead of falling through to whatever week-1 CPU games are still sitting in the DB.
  if (!input.weekNumber && !stageHasScheduledGames(seasonStage, context.rec_leagues.game)) {
    return {
      currentWeek,
      selectedWeek: currentWeek,
      weekNumbers: [],
      usersByConference: [],
      gotw: null,
      games: [],
      isOffseason: true,
      offseasonStageLabel: stageLabel(seasonStage, currentWeek, context.rec_leagues.game),
    };
  }
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  if (context.rec_leagues.game === "cfb_27" || String(context.rec_leagues.game ?? "").startsWith("madden_")) {
    const leagueTeams = await supabase.from("rec_teams").select("id,abbreviation,is_relocated,primary_color").eq("league_id", context.leagueId);
    if (leagueTeams.error) throw new ApiError(500, "We couldn't load matchup team colors. Please try again.", leagueTeams.error);
    const colorMap = String(context.rec_leagues.game ?? "").startsWith("madden_")
      ? NFL_TEAM_PRIMARY_COLORS
      : CFB_TEAM_PRIMARY_COLORS;
    await Promise.all((leagueTeams.data ?? []).map((team: any) => {
      // For relocated/custom teams, preserve commissioner-assigned colors.
      // For standard teams, update if the DB color doesn't match the catalog (handles both
      // empty/null values AND the default '#FFFFFF' that was seeded before the color catalog existed).
      if (team.is_relocated) return Promise.resolve();
      const catalogColor = colorMap[String(team.abbreviation ?? "").toUpperCase()] ?? "#FFFFFF";
      if (String(team.primary_color ?? "").trim().toUpperCase() === catalogColor.toUpperCase()) return Promise.resolve();
      return supabase
        .from("rec_teams")
        .update({ primary_color: catalogColor })
        .eq("id", team.id)
        .then(() => undefined);
    }));
  }
  let gamesQuery = supabase
    .from("rec_games")
    .select("id,week_number,home_user_id,away_user_id,home_score,away_score,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,conference,display_city,display_nick,primary_color),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,conference,display_city,display_nick,primary_color),rivalry:rec_league_rivalries(rivalry_name)")
    .eq("league_id", context.leagueId)
    .eq("week_number", selectedWeek);
  if (seasonId) gamesQuery = gamesQuery.eq("season_id", seasonId);
  const [games, weeks, results, streamLogs, streamViewsForWeek, streamReactionsForWeek, assignments, gotwPoll] = await Promise.all([
    gamesQuery,
    supabase.from("rec_games").select("week_number").eq("league_id", context.leagueId).order("week_number", { ascending: true }),
    supabase.from("rec_game_results").select("home_team_id,away_team_id,home_score,away_score,is_tie,winning_team_id,source").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek),
    supabase.from("rec_stream_compliance_logs").select("id,user_id,message_url,posted_at,details").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek).eq("status", "posted").gte("posted_at", streamLiveSince()).is("ended_at", null).order("posted_at", { ascending: false }),
    supabase.from("rec_stream_views").select("stream_log_id").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek),
    supabase.from("rec_stream_reactions").select("stream_log_id,user_id,reaction_key").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek),
    supabase.from("rec_team_assignments").select("user_id,team:rec_teams(id,name,abbreviation,conference,division),user:rec_users(username,display_name)").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null),
    // Every H2H game from Conference Championship forward is GOTW-eligible in CFB, so a
    // week can now carry many concurrent polls, not just one — fetch them all instead of
    // the single most-recent poll.
    supabase.from("rec_game_of_week_polls").select("*").eq("league_id", context.leagueId).eq("season_number", seasonNumber).eq("week_number", selectedWeek).in("status", ["open", "closed"]).order("created_at", { ascending: false }),
  ]);
  if (games.error || weeks.error || results.error || streamLogs.error || assignments.error || gotwPoll.error) throw new ApiError(500, "We couldn't load the matchup schedule. Please try again.", games.error ?? weeks.error ?? results.error ?? streamLogs.error ?? assignments.error ?? gotwPoll.error);
  if (streamViewsForWeek.error && !missingRelation(streamViewsForWeek.error, "rec_stream_views")) throw new ApiError(500, "We couldn't load stream views right now. Please try again.", streamViewsForWeek.error);
  if (streamReactionsForWeek.error && !missingRelation(streamReactionsForWeek.error, "rec_stream_reactions")) throw new ApiError(500, "We couldn't load stream reactions right now. Please try again.", streamReactionsForWeek.error);
  const polls = gotwPoll.data ?? [];
  const pollIds = polls.map((row: any) => row.id);
  const allVoteRows = pollIds.length
    ? await supabase.from("rec_game_of_week_votes").select("poll_id,selected_team_id,discord_id").in("poll_id", pollIds)
    : { data: [], error: null };
  if (allVoteRows.error) throw new ApiError(500, "We couldn't load GOTW votes right now. Please try again.", allVoteRows.error);
  const votesByPollId = new Map<string, any[]>();
  for (const vote of allVoteRows.data ?? []) {
    const list = votesByPollId.get(vote.poll_id) ?? [];
    list.push(vote);
    votesByPollId.set(vote.poll_id, list);
  }
  const pollForGame = (game: any) => polls.find((row: any) =>
    row.game_id === game.id || (row.home_team_id === game.home_team?.id && row.away_team_id === game.away_team?.id));
  const assignmentUserIds = [...new Set((assignments.data ?? []).map((row: any) => row.user_id).filter(Boolean))] as string[];
  const accounts = assignmentUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", assignmentUserIds)
    : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "We couldn't load matchup user names. Please try again.", accounts.error);
  const accountByUserId = new Map((accounts.data ?? []).map((account: any) => [account.user_id, account]));
  const isSnowflake = (value: unknown) => /^\d{15,}$/.test(String(value ?? ""));
  const displayNameForUser = (row: any) => {
    const account = accountByUserId.get(row.user_id) as any;
    const recUsername = row.user?.username ?? null;
    const storedName = row.user?.display_name ?? null;
    // A rec-leagues username is the canonical name once set. Only fall back to Discord
    // (immutable username, then global display name) for accounts with no site username,
    // and guard every source against a raw snowflake — accounts can be poisoned with the
    // Discord ID as a placeholder when the live lookup fails at link time.
    if (recUsername && !isSnowflake(recUsername)) return recUsername;
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
    list.push({ userId: row.user_id, displayName: displayNameForUser({ ...row, user }), teamName: formatTeamDisplayName(team) ?? team?.name ?? team?.abbreviation ?? "Team", division: team?.division ?? null });
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
  const [boxScores, gameReactionsForWeek] = await Promise.all([
    gameIds.length
      ? supabase.from("rec_box_score_submissions").select("id,game_id,status,denied_reason,updated_at").in("game_id", gameIds).in("status", ["pending", "approved", "denied"]).order("updated_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    gameIds.length
      ? supabase.from("rec_game_reactions").select("game_id,user_id,reaction_key,comment").in("game_id", gameIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (boxScores.error) throw new ApiError(500, "We couldn't load matchup box-score status. Please try again.", boxScores.error);
  if (gameReactionsForWeek.error) throw new ApiError(500, "We couldn't load matchup reactions. Please try again.", gameReactionsForWeek.error);
  const boxScoreByGameId = new Map<string, any>((boxScores.data ?? []).map((row: any) => [row.game_id, row]));
  const mappedGames = (games.data ?? []).filter((game: any) => game.home_user_id || game.away_user_id).map((game: any) => {
      const result = resultByTeams.get(`${game.home_team?.id}:${game.away_team?.id}`) ?? null;
      const homeScore = result?.home_score ?? game.home_score ?? null;
      const awayScore = result?.away_score ?? game.away_score ?? null;
      const isFinal = Boolean(result) || ["final", "completed", "played"].includes(String(game.status ?? "").toLowerCase()) || (homeScore != null && awayScore != null && selectedWeek < currentWeek);
      const showStreams = !isFinal && game.home_user_id && game.away_user_id;
      const homeStream = showStreams ? streamByUser.get(game.home_user_id) ?? null : null;
      const awayStream = showStreams ? streamByUser.get(game.away_user_id) ?? null : null;
      const boxScore = boxScoreByGameId.get(game.id) ?? null;
      const gameReactionRows = (gameReactionsForWeek.data ?? []).filter((reaction: any) => reaction.game_id === game.id);
      // Older GOTW rows can point at a superseded rec_games id after a schedule refresh.
      // Team identity is the durable fallback so a game's poll is never silently dropped.
      const gamePoll = pollForGame(game);
      const gameVotes = gamePoll ? votesByPollId.get(gamePoll.id) ?? [] : [];
      const gotwHasFinal = isFinal || Boolean(boxScore && boxScore.status !== "denied");
      const gotwCanVote = Boolean(gamePoll && gamePoll.status === "open" && !gotwHasFinal);
      const gotw = gamePoll ? {
        pollId: gamePoll.id,
        gameId: game.id,
        status: gotwCanVote ? "open" as const : "closed" as const,
        canVote: gotwCanVote,
        awayTeamId: gamePoll.away_team_id,
        homeTeamId: gamePoll.home_team_id,
        awayTeamName: gamePoll.away_team_name,
        homeTeamName: gamePoll.home_team_name,
        awayVotes: gameVotes.filter((vote: any) => vote.selected_team_id === gamePoll.away_team_id).length,
        homeVotes: gameVotes.filter((vote: any) => vote.selected_team_id === gamePoll.home_team_id).length,
        myVote: gameVotes.find((vote: any) => vote.discord_id === input.discordId)?.selected_team_id ?? null,
      } : null;
      return {
        gameId: game.id,
        weekNumber: Number(game.week_number),
        matchupType: game.home_user_id && game.away_user_id ? "h2h" : game.home_user_id || game.away_user_id ? "human_cpu" : "cpu",
        involvesMe: game.home_user_id === userId || game.away_user_id === userId,
        viewerSide: game.home_user_id === userId ? "home" : game.away_user_id === userId ? "away" : null,
        isGameOfWeek: Boolean(gamePoll),
        gotw,
        homeTeamId: game.home_team?.id ?? null,
        awayTeamId: game.away_team?.id ?? null,
        homeTeamName: universityName(game.home_team, "Home"),
        awayTeamName: universityName(game.away_team, "Away"),
        homeTeamMascot: mascotName(game.home_team, "Home"),
        awayTeamMascot: mascotName(game.away_team, "Away"),
        homeTeamColor: game.home_team?.primary_color ?? "#FFFFFF",
        awayTeamColor: game.away_team?.primary_color ?? "#FFFFFF",
        rivalryName: (Array.isArray(game.rivalry) ? game.rivalry[0] : game.rivalry)?.rivalry_name ?? null,
        homeConference: game.home_team?.conference ?? null,
        awayConference: game.away_team?.conference ?? null,
        homeScore,
        awayScore,
        isFinal,
        wageringOpen: String(game.status ?? "scheduled").toLowerCase() === "scheduled" && !isFinal,
        winnerTeamId: result?.winning_team_id ?? null,
        boxScoreSubmissionId: boxScore?.id ?? null,
        boxScoreStatus: boxScore?.status ?? null,
        boxScoreDeniedReason: boxScore?.status === "denied" ? (boxScore?.denied_reason ?? null) : null,
        reactionCounts: Object.fromEntries(["love", "like", "goty", "dislike", "poop"].map((key) => [key, gameReactionRows.filter((reaction: any) => reaction.reaction_key === key).length])),
        myReactions: gameReactionRows.filter((reaction: any) => reaction.user_id === userId).map((reaction: any) => reaction.reaction_key),
        myGotyComment: gameReactionRows.find((reaction: any) => reaction.user_id === userId && reaction.reaction_key === "goty")?.comment ?? null,
        streams: [
          awayStream ? { side: "away", userId: game.away_user_id, teamName: formatTeamDisplayName(game.away_team) ?? game.away_team?.name ?? game.away_team?.abbreviation ?? "Away", streamLogId: awayStream.id, url: awayStream.message_url, watchPath: streamWatchPath(awayStream.id), postedAt: awayStream.posted_at ?? null, ...streamEngagement(awayStream) } : null,
          homeStream ? { side: "home", userId: game.home_user_id, teamName: formatTeamDisplayName(game.home_team) ?? game.home_team?.name ?? game.home_team?.abbreviation ?? "Home", streamLogId: homeStream.id, url: homeStream.message_url, watchPath: streamWatchPath(homeStream.id), postedAt: homeStream.posted_at ?? null, ...streamEngagement(homeStream) } : null,
        ].filter(Boolean),
      };
    }).sort((a: any, b: any) => Number(b.isGameOfWeek) - Number(a.isGameOfWeek) || Number(b.involvesMe) - Number(a.involvesMe) || Number(b.matchupType === "h2h") - Number(a.matchupType === "h2h") || a.awayTeamName.localeCompare(b.awayTeamName));
  const gotwGames = mappedGames.filter((game: any) => game.gotw);
  return {
    currentWeek,
    selectedWeek,
    weekNumbers,
    usersByConference: [...usersByConference.entries()].map(([conference, users]) => ({ conference, users: users.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName)) })),
    // Kept for the single-game "featured" hero card (regular-season style, one GOTW pick).
    // Postseason weeks can have many concurrent GOTW games — render those from each game's
    // own `gotw` field instead of this singular one.
    gotw: gotwGames.length === 1 ? gotwGames[0].gotw : null,
    games: mappedGames,
    isOffseason: false,
    offseasonStageLabel: null,
  };
}

export async function getHubMatchupDetail(input: { guildId: string; discordId: string; gameId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const viewerUserId = await userIdForDiscord(input.discordId);
  const game = await supabase.from("rec_games").select("id,week_number,home_user_id,away_user_id").eq("id", input.gameId).eq("league_id", context.leagueId).maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that matchup. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Matchup not found.");
  // Only a true CPU-vs-CPU game (neither side human) has no detail page worth loading —
  // human_cpu games have one human participant who still needs box score/highlight uploads,
  // wager context, etc. from this same detail load; only game chat (below) stays CPU-gated.
  if (!game.data.home_user_id && !game.data.away_user_id) throw new ApiError(400, "CPU-vs-CPU matchups do not have a matchup detail page.");
  const schedule = await getHubMatchupSchedule({ guildId: input.guildId, discordId: input.discordId, weekNumber: Number(game.data.week_number) });
  const matchup = schedule.games.find((item: any) => item.gameId === input.gameId);
  if (!matchup) throw new ApiError(404, "Matchup not found in this league week.");
  const draft = await bestEffort("hub.league_config_draft", () => getLeagueConfigAsDraft(input.guildId)
    .then((result) => (result as any)?.draft ?? null), { guildId: input.guildId }) ?? null;
  const postseason = isPostseasonStage(context.rec_leagues.season_stage);
  const streamingSide = postseason
    ? String(draft?.postseasonStreamingSide ?? "either")
    : String(draft?.regularSeasonStreamingSide ?? "either");
  const streamLogs = await supabase
    .from("rec_stream_compliance_logs")
    .select("id,user_id,team_id,message_url,posted_at,game_id")
    .eq("league_id", context.leagueId)
    .eq("season_number", Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1))
    .eq("week_number", Number(game.data.week_number))
    .eq("status", "posted")
    .not("message_url", "is", null)
    .gte("posted_at", streamLiveSince())
    .is("ended_at", null)
    .in("user_id", [game.data.away_user_id, game.data.home_user_id])
    .order("posted_at", { ascending: true });
  if (streamLogs.error) throw new ApiError(500, "We couldn't load matchup streams. Please try again.", streamLogs.error);
  const streamRows = (streamLogs.data ?? []).filter((row: any) => !row.game_id || row.game_id === input.gameId);
  const streamLogIds = streamRows.map((row: any) => row.id);
  const [streamViews, streamReactions] = await Promise.all([
    streamLogIds.length
      ? supabase.from("rec_stream_views").select("stream_log_id").in("stream_log_id", streamLogIds)
      : Promise.resolve({ data: [], error: null }),
    streamLogIds.length
      ? supabase
          .from("rec_stream_reactions")
          .select("stream_log_id,user_id,reaction_key")
          .in("stream_log_id", streamLogIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (streamViews.error && !missingRelation(streamViews.error, "rec_stream_views")) {
    throw new ApiError(500, "We couldn't load stream views right now. Please try again.", streamViews.error);
  }
  if (streamReactions.error && !missingRelation(streamReactions.error, "rec_stream_reactions")) {
    throw new ApiError(500, "We couldn't load stream reactions right now. Please try again.", streamReactions.error);
  }
  const streams = streamRows.map((row: any) => {
    const side =
      row.user_id === game.data.away_user_id
        ? "away"
        : row.user_id === game.data.home_user_id
          ? "home"
          : row.team_id && row.team_id === matchup.awayTeamId
            ? "away"
            : "home";
    const reactionRows = (streamReactions.data ?? []).filter(
      (reaction: any) => reaction.stream_log_id === row.id,
    );
    const teamName = side === "away" ? matchup.awayTeamName : matchup.homeTeamName;
    return {
      side,
      userId: row.user_id,
      teamName,
      streamLogId: row.id,
      url: row.message_url,
      watchPath: streamWatchPath(row.id),
      postedAt: row.posted_at ?? null,
      viewCount: (streamViews.data ?? []).filter((view: any) => view.stream_log_id === row.id)
        .length,
      reactionCounts: {
        like: reactionRows.filter((reaction: any) => reaction.reaction_key === "like").length,
        dislike: reactionRows.filter((reaction: any) => reaction.reaction_key === "dislike").length,
      },
      myReaction:
        reactionRows.find((reaction: any) => reaction.user_id === viewerUserId)?.reaction_key ??
        null,
    };
  });
  const designatedSides =
    streamingSide === "both"
      ? new Set(["away", "home"])
      : streamingSide === "away"
        ? new Set(["away"])
        : streamingSide === "home"
          ? new Set(["home"])
          : new Set<string>();
  const designatedPool = designatedSides.size
    ? streams.filter((stream: any) => designatedSides.has(stream.side))
    : [];
  const primaryStream = designatedPool.length
    ? designatedPool[0]
    : streams[0] ?? null;
  const secondaryStream =
    streams.find((stream: any) => stream.streamLogId !== primaryStream?.streamLogId) ?? null;
  const gameChannel = await getGameChannelByGameId(input.gameId);
  const messages = gameChannel
    ? await getGameChatMessages({ guildId: input.guildId, gameChannelId: gameChannel.id })
    : { messages: [] };
  // "This isn't these two coaches' first meeting" — every prior H2H result between this
  // game's two participants, across every league (including leagues since deleted).
  const h2h = await getH2hHistory(game.data.home_user_id, game.data.away_user_id).catch(() => ({ lastMatchup: null, history: [] }));
  return {
    matchup: { ...matchup, streams },
    streamFeature: {
      streamingSide,
      primaryStreamLogId: primaryStream?.streamLogId ?? null,
      secondaryStreamLogId: secondaryStream?.streamLogId ?? null,
    },
    gotw: matchup.gotw,
    h2hHistory: h2h.history,
    lastMatchup: h2h.lastMatchup,
    messages: messages.messages,
  };
}

export async function sendHubMatchupMessage(input: { guildId: string; discordId: string; gameId: string; body: string }) {
  const gameChannel = await getGameChannelByGameId(input.gameId);
  if (!gameChannel) throw new ApiError(409, "This matchup does not have an active bridged game chat.");
  return sendGameChatMessage({
    guildId: input.guildId,
    discordId: input.discordId,
    gameChannelId: gameChannel.id,
    body: input.body,
  });
}

export async function shareHubMatchupStream(input: {
  guildId: string;
  discordId: string;
  gameId: string;
  url: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const cleanedUrl = String(input.url ?? "").trim();
  if (!/^https?:\/\//i.test(cleanedUrl)) {
    throw new ApiError(400, "Enter a full stream URL (https://...).");
  }

  const game = await supabase
    .from("rec_games")
    .select(
      "id,week_number,season_stage,home_user_id,away_user_id,home_team_id,away_team_id",
    )
    .eq("id", input.gameId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that matchup's stream details. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Matchup not found.");

  const isHome = game.data.home_user_id === userId;
  const isAway = game.data.away_user_id === userId;
  if (!isHome && !isAway) {
    throw new ApiError(403, "Only matchup participants can post streams.");
  }

  const seasonNumber = Number(
    context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1,
  );
  const weekNumber = Number(game.data.week_number ?? context.rec_leagues.current_week ?? 1);
  const teamId = isHome ? game.data.home_team_id : game.data.away_team_id;
  const side = isHome ? "home" : "away";
  const service = detectStreamService(cleanedUrl);
  const now = new Date().toISOString();

  const inserted = await supabase
    .from("rec_stream_compliance_logs")
    .insert({
      id: randomUUID(),
      league_id: context.leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: input.gameId,
      user_id: userId,
      team_id: teamId ?? null,
      required: false,
      complied: true,
      status: "posted",
      message_url: cleanedUrl,
      posted_at: now,
      checked_at: now,
      created_at: now,
      updated_at: now,
      details: {
        service,
        side,
        source: "web_matchup_detail",
        submissionType: "link",
        content: cleanedUrl,
      },
    })
    .select("id")
    .single();
  if (inserted.error) throw new ApiError(500, "We couldn't save that stream URL. Please try again.", inserted.error);

  await markGameStarted({ gameId: input.gameId }).catch((error) => console.error("[ERROR] Failed to mark game started from stream share (non-fatal):", error));
  // markGameStarted no-ops once the game is already live, so a second/third stream (the other
  // coach's, or a re-share) would never otherwise get its link added to the announcement embed.
  await postOrUpdateGameAnnouncement(input.gameId, { announceNow: false }).catch((error) => console.error("[ERROR] Failed to refresh game announcement with stream link (non-fatal):", error));
  const { refreshMatchupsChannelForGame } = await import("../scheduling/matchups-channel.service.js");
  await refreshMatchupsChannelForGame(input.gameId);

  await Promise.all([
    closeWageringForGame({ guildId: input.guildId, gameId: input.gameId }),
    supabase
      .from("rec_game_of_week_polls")
      .update({
        status: "closed",
        closed_at: now,
        updated_at: now,
      })
      .eq("league_id", context.leagueId)
      .eq("game_id", input.gameId)
      .eq("status", "open"),
  ]);

  // Parity with the Discord stream command: same $50 payout-review eligibility/creation.
  const payout = await createStreamPayoutReview({
    guildId: input.guildId,
    leagueId: context.leagueId,
    userId,
    discordId: input.discordId,
    teamId: teamId ?? null,
    streamLogId: inserted.data.id,
    seasonNumber,
    weekNumber,
  }).catch((error) => {
    console.error("[ERROR] Failed to create stream payout review for site-submitted stream (non-fatal):", error);
    return null;
  });

  // Cross-communication: mirror the site-submitted stream into Discord's streams channel (if
  // this league is linked to a server) and post a public notice in league chat — best-effort,
  // never blocks the stream submission itself.
  void (async () => {
    const matchupContext = await deriveStreamMatchupContext(context.leagueId, input.gameId);
    if (!matchupContext) return;
    const author = await resolveChatAuthor(input.discordId);
    await Promise.all([
      postStreamToDiscordChannel(
        context.routes,
        `🔴 **${matchupContext.matchupLabel}** — ${matchupContext.awayTeamName} at ${matchupContext.homeTeamName}: ${author.displayName} is live! ${cleanedUrl}`,
      ),
      postLeagueChatStreamNotice({
        leagueId: context.leagueId,
        seasonNumber,
        awayTeamName: matchupContext.awayTeamName,
        homeTeamName: matchupContext.homeTeamName,
        matchupLabel: matchupContext.matchupLabel,
        posterDisplayName: author.displayName,
        url: cleanedUrl,
      }),
    ]);
  })().catch((error) => console.error("[ERROR] Failed to mirror site-submitted stream (non-fatal):", error));

  return {
    posted: true,
    streamLogId: inserted.data.id,
    watchPath: streamWatchPath(inserted.data.id),
    service,
    payoutPending: Boolean(payout?.created),
  };
}

export async function voteGameOfWeek(input: { guildId: string; discordId: string; pollId: string; selectedTeamId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdForDiscord(input.discordId);
  const poll = await supabase.from("rec_game_of_week_polls").select("*").eq("id", input.pollId).eq("league_id", context.leagueId).maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that GOTW poll. Please try again.", poll.error);
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
  if (voted.error) throw new ApiError(500, "We couldn't save your GOTW vote. Please try again.", voted.error);
  return { voted: true };
}

export async function closeGameOfWeekVoting(input: { guildId: string; pollId: string; closedByDiscordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const closed = await supabase.from("rec_game_of_week_polls").update({ status: "closed", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.pollId).eq("league_id", context.leagueId).eq("status", "open").select("id").maybeSingle();
  if (closed.error) throw new ApiError(500, "We couldn't close GOTW voting. Please try again.", closed.error);
  if (!closed.data) throw new ApiError(400, "GOTW voting is already closed or unavailable.");
  return { closed: true };
}

// Undo an accidental close — brings a "closed" poll back to "open" so voting can continue.
// Doesn't apply to "cancelled" polls (cancel is a hard void, not a pause); use a fresh poll
// for those instead.
export async function reopenGameOfWeekVoting(input: { guildId: string; pollId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const reopened = await supabase.from("rec_game_of_week_polls").update({ status: "open", closed_at: null, updated_at: new Date().toISOString() }).eq("id", input.pollId).eq("league_id", context.leagueId).eq("status", "closed").select("id").maybeSingle();
  if (reopened.error) throw new ApiError(500, "We couldn't reopen GOTW voting. Please try again.", reopened.error);
  if (!reopened.data) throw new ApiError(400, "Only a closed GOTW poll can be reopened.");
  return { reopened: true };
}

// Distinct from closeGameOfWeekVoting: cancelling voids the poll entirely (no settlement, no
// payout, disappears from the matchup page) rather than just freezing the current tally — for
// when the game itself won't be played as a real head-to-head (a Fair Sim or Force Win), so
// nobody's pick was ever really "correct" or "wrong".
export async function cancelGameOfWeekVoting(input: { guildId: string; pollId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const poll = await supabase.from("rec_game_of_week_polls").select("id,status").eq("id", input.pollId).eq("league_id", context.leagueId).maybeSingle();
  if (poll.error) throw new ApiError(500, "We couldn't load that GOTW poll. Please try again.", poll.error);
  if (!poll.data) throw new ApiError(404, "GOTW poll not found.");
  if (poll.data.status === "settled") throw new ApiError(400, "This GOTW poll has already been settled and can't be cancelled.");
  if (poll.data.status !== "cancelled") {
    const now = new Date().toISOString();
    const cancelled = await supabase.from("rec_game_of_week_polls").update({ status: "cancelled", closed_at: now, updated_at: now }).eq("id", input.pollId);
    if (cancelled.error) throw new ApiError(500, "We couldn't cancel that GOTW poll. Please try again.", cancelled.error);
  }
  return { cancelled: true };
}
