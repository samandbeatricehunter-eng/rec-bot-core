import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { assertGuildPermission, requireBotOrUserSession, resolveBotOrUserAuth } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  appendBoxScoreImage,
  correctBoxScoreSubmission,
  getBoxScoreSubmission,
  getBoxScoreUploadEligibility,
  listBoxScoresPendingDiscordCleanup,
  listScheduledGamesForWeek,
  listPendingBoxScores,
  markBoxScoreDiscordCleanupDone,
  parseBoxScorePreview,
  persistUploadedImageBuffer,
  reviewBoxScore,
  updateBoxScoreLedgerMessage,
} from "./box-score.service.js";
import { getBoxScoreSubmissionJob, getJobGuildId, startBoxScoreSubmissionJob } from "./box-score-jobs.js";

const SUPPORTED_UPLOAD_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  extraDiscordMessageIds: z.array(z.string()).optional().nullable(),
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
      const input = SubmitSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => input.guildId, permission: "co_commissioner" });
      return reply.send(startBoxScoreSubmissionJob(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Poll a box-score OCR job started by /v1/box-score/submit. Jobs are keyed by an
  // unguessable UUID (same trust model as submissionId above) — a user session must
  // still prove it owns the guild the job was started for.
  app.post("/v1/box-score/job", async (request, reply) => {
    try {
      const auth = await resolveBotOrUserAuth(request);
      const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.body);
      if (auth.mode === "user") {
        await assertGuildPermission(auth.guildId, auth.discordId, "co_commissioner");
        const jobGuildId = getJobGuildId(jobId);
        if (jobGuildId && jobGuildId !== auth.guildId) throw new ApiError(404, "Job not found.");
      }
      return reply.send(getBoxScoreSubmissionJob(jobId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Browser file upload (the bot's flows always start from an already-hosted Discord CDN
  // URL instead). guildId travels as a query param, not a multipart field, so the
  // permission check can run before the file stream is even read. Returns a public URL
  // the frontend then passes into /v1/box-score/submit's imageUrls.
  app.post("/v1/box-score/upload-image", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.query);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      const file = await request.file();
      if (!file) throw new ApiError(400, "Missing file.");
      if (!SUPPORTED_UPLOAD_MIME_TYPES.has(file.mimetype)) throw new ApiError(400, "Unsupported image type.");
      const buffer = await file.toBuffer();
      const url = await persistUploadedImageBuffer(`uploads/${randomUUID()}`, buffer, file.mimetype);
      return reply.send({ url });
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
      const auth = await resolveBotOrUserAuth(request);
      const input = CorrectSchema.parse(request.body);
      if (auth.mode === "user") {
        await assertGuildPermission(auth.guildId, auth.discordId, "co_commissioner");
        const submission = await getBoxScoreSubmission(input.submissionId);
        await assertSubmissionInSessionGuild(auth.guildId, (submission as { league_id: string }).league_id);
        input.reviewedByDiscordId = auth.discordId;
      }
      return reply.send(await correctBoxScoreSubmission(input));
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

  // Bot-only: a coach's late second screenshot for their own already-pending submission
  // (posted after the 2-minute exchange window closed but still the same game week).
  app.post("/v1/box-score/append-image", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        imageUrl: z.string().url(),
      }).parse(request.body);
      return reply.send(await appendBoxScoreImage({ mode: "self_serve", ...input }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner fills in a screenshot missing from a pending submission (review UI).
  app.post("/v1/box-score/append-image-commissioner", async (request, reply) => {
    try {
      const auth = await resolveBotOrUserAuth(request);
      const input = z.object({
        submissionId: z.string().uuid(),
        imageUrl: z.string().url(),
      }).parse(request.body);
      if (auth.mode === "user") {
        await assertGuildPermission(auth.guildId, auth.discordId, "co_commissioner");
        const submission = await getBoxScoreSubmission(input.submissionId);
        await assertSubmissionInSessionGuild(auth.guildId, (submission as { league_id: string }).league_id);
      }
      return reply.send(await appendBoxScoreImage({ mode: "commissioner", ...input }));
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

  // Bot-only: polled on an interval to find approved/denied submissions whose source
  // screenshot message(s) still need deleting from the Discord channel (covers both the
  // Discord-native approve button and web-dashboard approvals, since the bot has no other
  // way to learn a web approval happened).
  app.post("/v1/box-score/pending-cleanup", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send({ submissions: await listBoxScoresPendingDiscordCleanup(guildId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/box-score/mark-cleanup-done", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(request.body);
      return reply.send(await markBoxScoreDiscordCleanupDone(submissionId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
