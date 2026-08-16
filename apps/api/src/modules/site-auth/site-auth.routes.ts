import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { listInstallableDiscordGuilds } from "../../lib/discord-oauth.js";
import {
  checkSiteUsername,
  ensureAccountForSession,
  getSiteLinkProfile,
  linkDiscordFromOAuth,
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

  // Called right after a "guilds"-scoped Discord OAuth round-trip completes (see
  // apps/site/src/routes/DiscordGuildPicker.tsx) — the provider token is short-lived and never
  // persisted server-side, so this must be called immediately with a fresh one.
  app.post("/v1/site-auth/discord-guilds", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      const body = z.object({ providerToken: z.string().min(1) }).parse(request.body ?? {});
      return reply.send({ guilds: await listInstallableDiscordGuilds(body.providerToken) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/link/discord-oauth", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send(
        await linkDiscordFromOAuth({
          authUserId: session.authUserId,
          email: session.email,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Registration flow: guarantees a rec_users row exists for the current session's email
  // signup right after account confirmation, instead of deferring it to first checkout.
  app.post("/v1/site-auth/ensure-account", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send(await ensureAccountForSession({ authUserId: session.authUserId, email: session.email }));
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
