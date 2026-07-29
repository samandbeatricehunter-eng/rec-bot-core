import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { getUserCompDetail, listConnectedUsers } from "./comp.service.js";

export async function compRoutes(app: FastifyInstance) {
  app.post("/v1/comp/users/list", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      const body = z.object({ page: z.number().int().min(1).optional() }).parse(request.body ?? {});
      return reply.send(await listConnectedUsers(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/comp/users/detail", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      const body = z.object({ userId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await getUserCompDetail(body.userId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
