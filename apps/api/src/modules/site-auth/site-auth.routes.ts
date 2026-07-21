import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  checkSiteUsername,
  getSiteLinkProfile,
  listLinkCandidates,
  requestIdentityClaimCode,
  setSiteUsername,
  verifyIdentityClaimCode,
} from "./site-auth.service.js";

export async function siteAuthRoutes(app: FastifyInstance) {
  app.post("/v1/site-auth/me", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send(await getSiteLinkProfile({ authUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/link/candidates", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      const body = z
        .object({
          query: z.string().trim().max(100).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await listLinkCandidates({
          query: body.query,
          limit: body.limit ?? 25,
          offset: body.offset ?? 0,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/link/request-code", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          discordAccountId: z.string().uuid(),
        })
        .parse(request.body);
      return reply.send(
        await requestIdentityClaimCode({
          authUserId: session.authUserId,
          discordAccountId: body.discordAccountId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/link/verify", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          discordAccountId: z.string().uuid(),
          code: z.string().regex(/^\d{6}$/),
        })
        .parse(request.body);
      return reply.send(
        await verifyIdentityClaimCode({
          authUserId: session.authUserId,
          discordAccountId: body.discordAccountId,
          code: body.code,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/username/set", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          username: z.string().trim().min(3).max(24),
        })
        .parse(request.body);
      return reply.send(
        await setSiteUsername({
          authUserId: session.authUserId,
          username: body.username,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/username/check", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          username: z.string().trim().min(1).max(24),
        })
        .parse(request.body);
      return reply.send(
        await checkSiteUsername({
          authUserId: session.authUserId,
          username: body.username,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
