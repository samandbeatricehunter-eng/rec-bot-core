import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getLeagueConferences, getTeamRoster } from "./rosters.service.js";

export async function rostersRoutes(app: FastifyInstance) {
  app.post("/v1/rosters/conferences", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.body as { guildId: string };
      return reply.send(await getLeagueConferences(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/rosters/team", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId, teamId } = request.body as { guildId: string; teamId: string };
      return reply.send(await getTeamRoster(guildId, teamId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
