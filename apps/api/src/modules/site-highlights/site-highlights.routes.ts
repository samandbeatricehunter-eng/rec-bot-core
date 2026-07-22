import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  createSiteHighlightDirectUpload,
  getSiteHighlightUploadStatus,
  listPendingSiteHighlightReviews,
  listSiteUploadableGames,
  markSiteHighlightUploadReceived,
  migrateMirroredHighlightsToStream,
  reviewSiteHighlightPayout,
} from "./site-highlights.service.js";

export async function siteHighlightsRoutes(app: FastifyInstance) {
  app.post("/v1/site-highlights/games", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({ leagueId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await listSiteUploadableGames({ authUserId: session.authUserId, leagueId: body.leagueId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-highlights/direct-upload", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({
        leagueId: z.string().uuid(),
        gameId: z.string().uuid(),
        fileName: z.string().max(200).optional().nullable(),
      }).parse(request.body ?? {});
      return reply.send(await createSiteHighlightDirectUpload({
        authUserId: session.authUserId,
        leagueId: body.leagueId,
        gameId: body.gameId,
        fileName: body.fileName,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-highlights/upload-received", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({
        leagueId: z.string().uuid(),
        highlightId: z.string().uuid(),
      }).parse(request.body ?? {});
      return reply.send(await markSiteHighlightUploadReceived({
        authUserId: session.authUserId,
        leagueId: body.leagueId,
        highlightId: body.highlightId,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-highlights/status", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({
        leagueId: z.string().uuid(),
        highlightId: z.string().uuid(),
      }).parse(request.body ?? {});
      return reply.send(await getSiteHighlightUploadStatus({
        authUserId: session.authUserId,
        leagueId: body.leagueId,
        highlightId: body.highlightId,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-highlights/pending", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({ leagueId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await listPendingSiteHighlightReviews({
        authUserId: session.authUserId,
        leagueId: body.leagueId,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-highlights/review", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({
        leagueId: z.string().uuid(),
        reviewId: z.string().uuid(),
        action: z.enum(["approve", "deny"]),
        deniedReason: z.string().max(500).optional(),
      }).parse(request.body ?? {});
      return reply.send(await reviewSiteHighlightPayout({
        authUserId: session.authUserId,
        leagueId: body.leagueId,
        reviewId: body.reviewId,
        action: body.action,
        deniedReason: body.deniedReason,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-highlights/migrate-to-stream", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({
        leagueId: z.string().uuid().optional().nullable(),
        limit: z.number().int().positive().max(100).optional(),
      }).parse(request.body ?? {});
      return reply.send(await migrateMirroredHighlightsToStream({
        authUserId: session.authUserId,
        leagueId: body.leagueId,
        limit: body.limit,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
