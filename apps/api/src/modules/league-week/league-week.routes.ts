import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { setLeagueWeek, viewLeagueWeek } from "./league-week.service.js";

const ViewLeagueWeekSchema = z.object({
  guildId: z.string().min(1)
});

const SetLeagueWeekSchema = z.object({
  guildId: z.string().min(1),
  weekNumber: z.number().int().min(1).max(30),
  seasonStage: z.string().min(1),
  seasonNumber: z.number().int().min(1).optional()
});

export async function leagueWeekRoutes(app: FastifyInstance) {
  app.post("/v1/league-week/view", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await viewLeagueWeek(ViewLeagueWeekSchema.parse(request.body).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/set", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await setLeagueWeek(SetLeagueWeekSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
