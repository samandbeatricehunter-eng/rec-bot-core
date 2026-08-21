import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getTeamScheduleManualState } from "../schedule/team-schedule.service.js";
import { getMatchupPreview } from "./matchup-preview.service.js";
import { getLeagueHistory } from "../league-history/league-history.service.js";
import { buildArticlePromptDigest } from "./article-prompt.service.js";
import { generateRoundtableHostName, getRoundtableHostConfig, resetRoundtableHost, updateRoundtableHost } from "./roundtable-hosts.service.js";
import {
  addHubStoryComment,
  cancelGameOfWeekVoting,
  closeGameOfWeekVoting,
  reopenGameOfWeekVoting,
  createCommissionerMediaArticle,
  getHub,
  getHubStreamingAccounts,
  getHubMatchupSchedule,
  getHubMatchupDetail,
  getHubBootstrapStatus,
  getHubMediaPortal,
  getMyRecentTransactions,
  getMyTeamSchedule,
  HUB_REACTION_KEYS,
  listHubStoryComments,
  persistMediaImageBuffer,
  publishHubStory,
  recordHubAnnouncement,
  recordHubHighlightView,
  recordHubStreamView,
  recordAnonymousStreamView,
  retireFromHub,
  reviewMediaSubmission,
  STREAM_VIEWER_COOKIE,
  submitInterview,
  submitUserMediaArticle,
  shareHubMatchupStream,
  sendHubMatchupMessage,
  toggleHubGameReaction,
  toggleHubHighlightReaction,
  toggleHubStreamReaction,
  toggleHubStoryReaction,
  voteGameOfWeek,
} from "./hub.service.js";
import { backfillDiscordHeadlines } from "./story-publishing.js";
import { getGotwGuessingRecordsForHub, getMyGotwGuessingRecord } from "../gotw/gotw.service.js";
import {
  listMaddenRelocationCatalog,
  persistTeamCrestBuffer,
  relocateHubTeam,
  reviewCustomTeamIdentity,
  submitCustomTeamIdentity,
} from "../team-ownership/team-identity.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

const ImageUrl = z.string().url().optional().nullable();

function cookieValue(cookieHeader: string | undefined, name: string) {
  return cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

export async function hubRoutes(app: FastifyInstance) {
  app.post("/v1/hub/view", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Hub view is a browser-only endpoint.");
      return reply.send(await getHub(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  // Checked by the web Hub when /v1/hub/view 404s (no league linked yet) — tells it
  // whether to offer a First-Time Setup entry point. No permission requirement of its
  // own beyond a valid session; canSetup itself is the meaningful gate.
  app.post("/v1/hub/bootstrap-status", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      if (auth.mode === "bot") throw new ApiError(400, "Bootstrap status is a browser-only endpoint.");
      return reply.send(await getHubBootstrapStatus(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/highlights/react", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), highlightId: z.string().uuid(), reactionKey: z.enum(HUB_REACTION_KEYS) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight reactions require a user session.");
      return reply.send(await toggleHubHighlightReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/highlights/view", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), highlightId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight views require a user session.");
      return reply.send(await recordHubHighlightView({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/my-team-schedule", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "My Team schedule is a browser-only endpoint.");
      return reply.send(await getMyTeamSchedule(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/league-history", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "League history is a browser-only endpoint.");
      return reply.send(await getLeagueHistory(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/my-transactions", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "My transactions is a browser-only endpoint.");
      return reply.send(await getMyRecentTransactions(body.guildId, auth.discordId, body.limit));
    } catch (error) { return sendError(reply, error); }
  });

  // Any member can view any team's schedule (public league info, scouting) — unlike the
  // commissioner schedule builder's /v1/schedule/team-manual-preview, this is read-only
  // and gated on "member", not "co_commissioner". getTeamScheduleManualState itself already
  // 404s if teamId isn't in the caller's own league, so no separate cross-league check needed.
  app.post("/v1/hub/team-schedule", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getTeamScheduleManualState(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/react", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), storyId: z.string().uuid(), reactionKey: z.enum(["like", "dislike"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Story reactions require a user session.");
      return reply.send(await toggleHubStoryReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/games/react", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        gameId: z.string().uuid(),
        reactionKey: z.enum(["love", "like", "goty", "dislike", "poop"]),
        comment: z.string().trim().max(280).optional().nullable(),
        mode: z.enum(["toggle", "set", "clear"]).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Game reactions require a user session.");
      return reply.send(await toggleHubGameReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/comments/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), storyId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listHubStoryComments(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/comments/add", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), storyId: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Comments require a user session.");
      return reply.send(await addHubStoryComment({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/announcements/record", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), title: z.string().min(1), body: z.string().min(1), discordChannelId: z.string().optional().nullable(), discordMessageId: z.string().optional().nullable() }).parse(request.body);
      return reply.send(await recordHubAnnouncement(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/announcements/publish", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), title: z.string().min(1).max(140), body: z.string().min(1).max(4000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "Use the announcement record endpoint for bot publishing.");
      return reply.send(await recordHubAnnouncement(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/publishing/article-prompt", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), weekFrom: z.number().int().min(0), weekTo: z.number().int().min(0) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await buildArticlePromptDigest(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/publishing/roundtable-hosts", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await getRoundtableHostConfig(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/publishing/roundtable-hosts/update", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), voice: z.enum(["caleb", "maya", "theo", "nina"]), displayName: z.string().min(1).max(60), personalityKey: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Roundtable host management requires a website session.");
      return reply.send(await updateRoundtableHost({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/publishing/roundtable-hosts/reset", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), voice: z.enum(["caleb", "maya", "theo", "nina"]) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await resetRoundtableHost(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/publishing/roundtable-hosts/generate-name", async (request, reply) => {
    try {
      const { guildId, seed } = z.object({ guildId: z.string().min(1), seed: z.string().min(1).max(200) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(generateRoundtableHostName(seed));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/stories/publish", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), headline: z.string().min(1).max(180), body: z.string().min(1).max(6000), storyType: z.enum(["headline", "article"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "League stories require a commissioner session.");
      return reply.send(await publishHubStory({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/publishing/backfill-discord-headlines", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "Discord headline backfill requires a website session.");
      return reply.send(await backfillDiscordHeadlines(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/streams/view", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), streamLogId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Stream views require a user session.");
      return reply.send(await recordHubStreamView({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/streams/react", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), streamLogId: z.string().uuid(), reactionKey: z.enum(["like", "dislike"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Stream reactions require a user session.");
      return reply.send(await toggleHubStreamReaction({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/hub/streams/open/:streamLogId", async (request, reply) => {
    try {
      const { streamLogId } = z.object({ streamLogId: z.string().uuid() }).parse(request.params);
      const existingViewer = cookieValue(request.headers.cookie, STREAM_VIEWER_COOKIE);
      const viewerId = existingViewer && /^[a-f0-9-]{36}$/i.test(existingViewer) ? existingViewer : randomUUID();
      const result = await recordAnonymousStreamView({ streamLogId, anonymousViewerId: viewerId });
      reply.header("set-cookie", `${STREAM_VIEWER_COOKIE}=${viewerId}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
      return reply.redirect(result.url);
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/media/upload-image", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.query);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Media uploads require a user session.");
      const file = await request.file();
      if (!file) throw new ApiError(400, "Missing file.");
      const buffer = await file.toBuffer();
      const url = await persistMediaImageBuffer(guildId, buffer, file.mimetype);
      return reply.send({ url });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/media/portal", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Media portal requires a user session.");
      return reply.send(await getHubMediaPortal(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/media/article/submit", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), title: z.string().trim().min(1).max(180), body: z.string().trim().min(1).max(8000), imageUrl: ImageUrl }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Article submissions require a user session.");
      return reply.send(await submitUserMediaArticle({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/media/interview/submit", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        tagOpponent: z.boolean().optional(),
        answers: z.array(z.object({ questionId: z.string().min(1), question: z.string().min(1).max(280), answer: z.string().trim().min(1).max(1400) })).length(3),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Interview submissions require a user session.");
      return reply.send(await submitInterview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/media/commissioner-article", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), title: z.string().trim().min(1).max(180), body: z.string().trim().min(1).max(10000), imageUrl: ImageUrl, immediatePost: z.boolean().optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "Commissioner media publishing requires a user session.");
      return reply.send(await createCommissionerMediaArticle({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/media/review", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), reviewId: z.string().uuid(), action: z.enum(["approve", "deny"]), deniedReason: z.string().optional().nullable(), reviewedByDiscordId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") body.reviewedByDiscordId = auth.discordId;
      return reply.send(await reviewMediaSubmission(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/matchups/schedule", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), weekNumber: z.number().int().min(0).max(30).optional().nullable() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Matchup schedule requires a user session.");
      return reply.send(await getHubMatchupSchedule({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/matchups/detail", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Matchup detail requires a user session.");
      return reply.send(await getHubMatchupDetail({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/matchups/preview", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Matchup preview requires a user session.");
      return reply.send(await getMatchupPreview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/matchups/chat/send", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Matchup chat requires a user session.");
      return reply.send(await sendHubMatchupMessage({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/streaming/accounts", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Streaming accounts require a user session.");
      return reply.send(await getHubStreamingAccounts({ guildId: body.guildId, discordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/hub/matchups/stream/share", async (request, reply) => {
    try {
      const body = z
        .object({
          guildId: z.string().min(1),
          gameId: z.string().uuid(),
          url: z.string().trim().min(1).max(500).optional(),
        })
        .parse(request.body);
      const auth = await requireBotOrUserSession(request, {
        resolveGuildId: () => body.guildId,
        permission: "member",
      });
      if (auth.mode === "bot") {
        throw new ApiError(400, "Matchup stream sharing requires a user session.");
      }
      return reply.send(await shareHubMatchupStream({ ...body, discordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/hub/gotw/vote", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid(), selectedTeamId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "GOTW voting requires a user session.");
      return reply.send(await voteGameOfWeek({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/gotw/close", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "GOTW close requires a user session.");
      return reply.send(await closeGameOfWeekVoting({ ...body, closedByDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/gotw/reopen", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await reopenGameOfWeekVoting(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/gotw/cancel", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await cancelGameOfWeekVoting(body));
    } catch (error) { return sendError(reply, error); }
  });

  // Hub display: all users' per-league guessing records (Power Rankings modal) and the
  // current viewer's own record (GOTW voting cards on the league home + matchups pages).
  app.post("/v1/hub/gotw/guessing-records", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      const records = await getGotwGuessingRecordsForHub(body.guildId);
      const mine = auth.mode === "user" ? await getMyGotwGuessingRecord(body.guildId, auth.discordId) : null;
      return reply.send({ records, mine });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/hub/relocation/upload-logo", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.query);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Logo uploads require a user session.");
      const file = await request.file();
      if (!file) throw new ApiError(400, "Missing file.");
      const buffer = await file.toBuffer();
      const context = await getCurrentLeagueContext(guildId);
      const url = await persistTeamCrestBuffer(context.leagueId, buffer, file.mimetype);
      return reply.send({ url });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/relocation/catalog", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(listMaddenRelocationCatalog());
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/relocation/apply", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        cityId: z.string().min(1),
        keepBranding: z.boolean(),
        brandSlug: z.string().min(1).nullable().optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Relocation requires a user session.");
      return reply.send(await relocateHubTeam({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/relocation/custom", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        city: z.string().min(1),
        nick: z.string().min(1),
        abbr: z.string().min(2).max(4),
        primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        logoUrl: z.string().min(1),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Custom team submit requires a user session.");
      return reply.send(await submitCustomTeamIdentity({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/hub/relocation/review", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        inboxId: z.string().uuid(),
        action: z.enum(["approve", "deny"]),
        deniedReason: z.string().trim().max(500).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot") throw new ApiError(400, "Custom team review requires a user session.");
      return reply.send(await reviewCustomTeamIdentity({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  // Member self-service: end active team assignment for this Discord user in the guild's league.
  app.post("/v1/hub/retire", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Retire requires a user session.");
      return reply.send(await retireFromHub(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });
}
