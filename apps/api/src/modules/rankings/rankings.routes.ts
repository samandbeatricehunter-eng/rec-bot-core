import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { listPowerRankings, listRankedGames, refreshAllPowerRankings } from "./rankings.service.js";

export async function rankingsRoutes(app: FastifyInstance) {
  app.post("/v1/rankings/games", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      return reply.send({ games: listRankedGames() });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/rankings/list", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      const body = z
        .object({
          game: z.enum(["madden_26", "madden_27", "cfb_27"]),
          scope: z.enum(["dynasty", "comp"]),
        })
        .parse(request.body ?? {});
      return reply.send(await listPowerRankings(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  /** Cron: daily at midnight — recompute global dynasty/comp power rankings for every game. */
  app.post("/v1/rankings/refresh", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await refreshAllPowerRankings());
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
