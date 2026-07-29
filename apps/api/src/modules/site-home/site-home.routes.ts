import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { runDailyMaintenance } from "../maintenance/maintenance.service.js";
import {
  addHighlightComment,
  getSiteHomeCard,
  getSpotlightReel,
  listSiteAnnouncements,
  listUserBadges,
  listUserCareerStatsByGame,
  toggleSpotlightReaction,
} from "./site-home.service.js";

export async function siteHomeRoutes(app: FastifyInstance) {
  app.post("/v1/site-home/card", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send(await getSiteHomeCard({ authUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-home/announcements", async (_request, reply) => {
    try {
      return reply.send(await listSiteAnnouncements());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-home/spotlight", async (request, reply) => {
    try {
      let authUserId: string | null = null;
      try {
        const session = await requireSiteUserSession(request);
        authUserId = session.authUserId;
      } catch {
        authUserId = null;
      }
      return reply.send(await getSpotlightReel({ authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-home/spotlight/react", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          highlightId: z.string().uuid(),
          reactionKey: z.enum(["like", "dislike"]),
        })
        .parse(request.body ?? {});
      return reply.send(
        await toggleSpotlightReaction({
          authUserId: session.authUserId,
          highlightId: body.highlightId,
          reactionKey: body.reactionKey,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-home/spotlight/comment", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z
        .object({
          highlightId: z.string().uuid(),
          body: z.string().min(1).max(1000),
        })
        .parse(request.body ?? {});
      return reply.send(
        await addHighlightComment({
          authUserId: session.authUserId,
          highlightId: body.highlightId,
          body: body.body,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-home/badges", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send(await listUserBadges({ authUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/v1/site-home/career-stats", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      return reply.send(await listUserCareerStatsByGame({ authUserId: session.authUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });


  /** Cron: daily 8:00 AM America/Chicago — refresh top-5 Spotlight Reel. */
  app.post("/v1/site-home/spotlight/refresh", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await runDailyMaintenance());
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
