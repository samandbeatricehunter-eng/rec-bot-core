import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession, resolveCanonicalLeagueId } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { createHighlightAwardReview, getHighlightReviewDetail, listHighlightAwardCandidates, recordHighlightPost, reviewGameOfYearPayout, reviewHighlightPayout } from "./highlights.service.js";

const RecordHighlightSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  discordChannelId: z.string().min(1),
  discordMessageId: z.string().min(1),
  messageUrl: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
});

const ReviewHighlightSchema = z.object({
  // Optional because the bot's existing calls don't send it (bot-mode auth never checks
  // it — see resolveGuildId below); the web dashboard always sends it.
  guildId: z.string().min(1).optional(),
  leagueId: z.string().uuid().optional(),
  reviewId: z.string().uuid(),
  action: z.enum(["approve", "deny"]),
  reviewedByDiscordId: z.string().min(1),
  deniedReason: z.string().optional().nullable(),
});

const AwardReviewSchema = z.object({
  guildId: z.string().min(1),
  category: z.string().min(1),
  highlightPostId: z.string().uuid(),
  voteCount: z.number().int().min(0),
  amount: z.number().int().min(0).optional().nullable(),
});

export async function highlightRoutes(app: FastifyInstance) {
  app.post("/v1/highlights/post", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await recordHighlightPost(RecordHighlightSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/highlights/review", async (request, reply) => {
    try {
      const body = ReviewHighlightSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") body.reviewedByDiscordId = auth.discordId;
      const canonicalLeagueId = await resolveCanonicalLeagueId(auth);
      if (auth.mode === "user" && body.leagueId && body.leagueId !== canonicalLeagueId) throw new ApiError(403, "League mismatch.");
      const leagueId = canonicalLeagueId ?? body.leagueId;
      if (auth.mode === "user" && !leagueId) throw new ApiError(403, "League context is required.");
      return reply.send(await reviewHighlightPayout({ ...body, leagueId: leagueId ?? undefined }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/highlights/review-detail", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), reviewId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await getHighlightReviewDetail(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/highlights/award-candidates", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await listHighlightAwardCandidates(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/highlights/award-review", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createHighlightAwardReview(AwardReviewSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/highlights/game-of-the-year/review", async (request, reply) => {
    try {
      const body = ReviewHighlightSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      const reviewedByDiscordId = auth.mode === "user" ? auth.discordId : body.reviewedByDiscordId;
      const canonicalLeagueId = await resolveCanonicalLeagueId(auth);
      if (auth.mode === "user" && body.leagueId && body.leagueId !== canonicalLeagueId) throw new ApiError(403, "League mismatch.");
      const leagueId = canonicalLeagueId ?? body.leagueId;
      if (auth.mode === "user" && !leagueId) throw new ApiError(403, "League context is required.");
      return reply.send(await reviewGameOfYearPayout({ guildId: body.guildId ?? "", leagueId: leagueId ?? undefined, reviewId: body.reviewId, action: body.action, reviewedByDiscordId, deniedReason: body.deniedReason }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
