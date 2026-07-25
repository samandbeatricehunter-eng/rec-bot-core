import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { requireLinkedSiteUser } from "../site-inbox/site-inbox.service.js";
import { getVapidPublicKey, removeSubscription, saveSubscription } from "./push.service.js";

export async function pushRoutes(app: FastifyInstance) {
  app.get("/v1/push/public-key", async (_request, reply) => {
    return reply.send({ publicKey: getVapidPublicKey() });
  });

  app.post("/v1/push/subscribe", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z
        .object({
          endpoint: z.string().url(),
          keys: z.object({
            p256dh: z.string().min(1),
            auth: z.string().min(1),
          }),
        })
        .parse(request.body ?? {});
      const userAgent = request.headers["user-agent"];
      return reply.send(
        await saveSubscription({
          recUserId: user.recUserId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent: typeof userAgent === "string" ? userAgent : undefined,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/push/unsubscribe", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedSiteUser(session.authUserId);
      const body = z.object({ endpoint: z.string().url() }).parse(request.body ?? {});
      return reply.send(
        await removeSubscription({ recUserId: user.recUserId, endpoint: body.endpoint }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
