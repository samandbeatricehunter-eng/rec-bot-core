import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { listInstallableDiscordGuilds } from "../../lib/discord-oauth.js";
import {
  checkSiteUsername,
  getSiteLinkProfile,
  linkDiscordFromOAuth,
  setSiteUsername,
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

  app.post("/v1/site-auth/link/candidates", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      // Grandfather Discord identity claim dropdown is retired.
      return reply.code(410).send({
        error: "Identity claiming via Discord username dropdown has been removed. Use Discord OAuth or email signup, then subscribe.",
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/link/request-code", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      return reply.code(410).send({
        error: "Identity claiming via Discord DM code has been removed. Link Discord from My Account after you subscribe.",
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-auth/link/verify", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      return reply.code(410).send({
        error: "Identity claiming via Discord DM code has been removed. Link Discord from My Account after you subscribe.",
      });
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
