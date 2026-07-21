import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import {
  listMySiteLeagues,
  requireLinkedRecUser,
  retireFromSiteLeague,
} from "./site-leagues.service.js";

export async function siteLeaguesRoutes(app: FastifyInstance) {
  app.post("/v1/site-leagues/mine", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      return reply.send(await listMySiteLeagues({ recUserId: user.recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-leagues/retire", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z
        .object({
          leagueId: z.string().uuid(),
        })
        .parse(request.body ?? {});
      return reply.send(
        await retireFromSiteLeague({
          recUserId: user.recUserId,
          leagueId: body.leagueId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
