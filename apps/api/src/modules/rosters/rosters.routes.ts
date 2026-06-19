import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getLeagueConferences } from "./rosters.service.js";

const GuildBodySchema = z.object({
  guildId: z.string().min(1)
});

export async function rosterRoutes(app: FastifyInstance) {
  app.post("/v1/rosters/conferences", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await getLeagueConferences(GuildBodySchema.parse(request.body).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
