import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  listSiteNotifications,
  markSiteNotificationsRead,
  requireLinkedRecUser,
} from "./site-notifications.service.js";

export async function siteNotificationsRoutes(app: FastifyInstance) {
  app.post("/v1/site-notifications/list", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      return reply.send(await listSiteNotifications({ recUserId: user.recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-notifications/mark-read", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z
        .object({
          ids: z.array(z.string().min(1)).max(100),
        })
        .parse(request.body ?? {});
      return reply.send(
        await markSiteNotificationsRead({
          recUserId: user.recUserId,
          ids: body.ids,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
