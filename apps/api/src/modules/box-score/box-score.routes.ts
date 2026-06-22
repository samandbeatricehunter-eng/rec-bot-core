import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import {
  getBoxScoreSubmission,
  listPendingBoxScores,
  parseAndDraftSubmission,
  reviewBoxScore,
  submitBoxScoreForReview,
} from "./box-score.service.js";

const ParseSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  imageUrl1: z.string().url(),
  imageUrl2: z.string().url(),
  discordChannelId: z.string().optional().nullable(),
  discordMessageId: z.string().optional().nullable(),
});

const SubmitSchema = z.object({
  submissionId: z.string().uuid(),
  discordId: z.string().min(1),
});

const ReviewSchema = z.object({
  submissionId: z.string().uuid(),
  action: z.enum(["approve", "deny"]),
  reviewedByDiscordId: z.string().min(1),
  deniedReason: z.string().optional().nullable(),
});

export async function boxScoreRoutes(app: FastifyInstance) {
  // Parse two screenshot URLs → draft submission + parsed data
  app.post("/v1/box-score/parse", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await parseAndDraftSubmission(ParseSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Confirm parsed data → submit for commissioner review
  app.post("/v1/box-score/submit", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await submitBoxScoreForReview(SubmitSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner approve or deny
  app.post("/v1/box-score/review", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await reviewBoxScore(ReviewSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // List pending submissions for commissioner inbox
  app.post("/v1/box-score/pending", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await listPendingBoxScores(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Get a single submission by ID (for commissioner review detail)
  app.post("/v1/box-score/get", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(request.body);
      return reply.send(await getBoxScoreSubmission(submissionId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
