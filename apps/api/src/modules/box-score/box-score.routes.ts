import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { assertGuildPermission, requireBotOrUserSession, resolveBotOrUserAuth } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  correctBoxScoreSubmission,
  getBoxScoreSubmission,
  getBoxScoreUploadEligibility,
  listScheduledGamesForWeek,
  listPendingBoxScores,
  parseBoxScorePreview,
  reviewBoxScore,
  updateBoxScoreLedgerMessage,
} from "./box-score.service.js";
import { getBoxScoreSubmissionJob, startBoxScoreSubmissionJob } from "./box-score-jobs.js";

// /get and /review are keyed by submissionId, not guildId, so the combined guard's usual
// "does the claimed guildId match the session" check doesn't apply directly — instead,
// for a user session, the submission's own league is checked against the session's guild
// after the fact (404 rather than 403 on mismatch, so a guessed UUID from another guild
// doesn't confirm its own existence).
async function assertSubmissionInSessionGuild(guildId: string, submissionLeagueId: string) {
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== submissionLeagueId) throw new ApiError(404, "Submission not found.");
}

const ParseSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  imageUrls: z.array(z.string().url()).min(1),
  seasonNumber: z.number().int().positive().optional().nullable(),
  // CFB regular season starts at Week 0.
  weekNumber: z.number().int().min(0).optional().nullable(),
  commissionerSubmission: z.boolean().optional().nullable(),
});

const SubmitSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  imageUrls: z.array(z.string().url()).min(1),
  discordChannelId: z.string().optional().nullable(),
  discordMessageId: z.string().optional().nullable(),
  ledgerDiscordMessageId: z.string().optional().nullable(),
  seasonNumber: z.number().int().positive().optional().nullable(),
  // CFB regular season starts at Week 0.
  weekNumber: z.number().int().min(0).optional().nullable(),
  expectedGameId: z.string().uuid().optional().nullable(),
  commissionerSubmission: z.boolean().optional().nullable(),
});

const ReviewSchema = z.object({
  submissionId: z.string().uuid(),
  action: z.enum(["approve", "deny"]),
  reviewedByDiscordId: z.string().min(1),
  deniedReason: z.string().optional().nullable(),
});

const CorrectSchema = z.object({
  submissionId: z.string().uuid(),
  reviewedByDiscordId: z.string().min(1),
  field: z.string().min(1),
  team1: z.string().optional().nullable(),
  team2: z.string().optional().nullable(),
  gameId: z.string().uuid().optional().nullable(),
});

export async function boxScoreRoutes(app: FastifyInstance) {
  // Parse screenshot URLs → parsed data + missing required fields (no DB write)
  app.post("/v1/box-score/parse", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await parseBoxScorePreview(ParseSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Start an OCR job → parse + persist happen in the background. Returns a jobId
  // immediately so the bot's request never has to wait out the (up to a minute+)
  // OCR run. The bot polls /v1/box-score/job for the result.
  app.post("/v1/box-score/submit", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(startBoxScoreSubmissionJob(SubmitSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Poll a box-score OCR job started by /v1/box-score/submit.
  app.post("/v1/box-score/job", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.body);
      return reply.send(getBoxScoreSubmissionJob(jobId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner approve or deny
  app.post("/v1/box-score/review", async (request, reply) => {
    try {
      const auth = await resolveBotOrUserAuth(request);
      const input = ReviewSchema.parse(request.body);
      if (auth.mode === "user") {
        await assertGuildPermission(auth.guildId, auth.discordId, "co_commissioner");
        const submission = await getBoxScoreSubmission(input.submissionId);
        await assertSubmissionInSessionGuild(auth.guildId, (submission as { league_id: string }).league_id);
        input.reviewedByDiscordId = auth.discordId;
      }
      return reply.send(await reviewBoxScore(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner correction of a pending submission's logged fields
  app.post("/v1/box-score/correct", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await correctBoxScoreSubmission(CorrectSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // List pending submissions for commissioner inbox
  app.post("/v1/box-score/pending", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await listPendingBoxScores(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Get a single submission by ID (for commissioner review detail)
  app.post("/v1/box-score/get", async (request, reply) => {
    try {
      const auth = await resolveBotOrUserAuth(request);
      const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(request.body);
      const submission = await getBoxScoreSubmission(submissionId);
      if (auth.mode === "user") {
        await assertGuildPermission(auth.guildId, auth.discordId, "co_commissioner");
        await assertSubmissionInSessionGuild(auth.guildId, (submission as { league_id: string }).league_id);
      }
      return reply.send(submission);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/box-score/games", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId, weekNumber, seasonNumber } = z.object({
        guildId: z.string().min(1),
        // CFB regular season starts at Week 0.
        weekNumber: z.number().int().min(0),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await listScheduledGamesForWeek(guildId, weekNumber, seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/box-score/upload-eligibility", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId, discordId } = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await getBoxScoreUploadEligibility({ guildId, discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/box-score/ledger-message", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { submissionId, ledgerDiscordMessageId } = z.object({
        submissionId: z.string().uuid(),
        ledgerDiscordMessageId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await updateBoxScoreLedgerMessage(submissionId, ledgerDiscordMessageId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
