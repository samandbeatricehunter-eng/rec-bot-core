import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getLeagueStats, getLeagueTeamStats } from "./league-stats.service.js";

export async function leagueStatsRoutes(app: FastifyInstance) {
  app.post("/v1/hub/league-stats", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid().nullable().optional(), position: z.string().max(20).nullable().optional(), scope: z.enum(["season", "career"]).optional() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getLeagueStats(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/hub/league-team-stats", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getLeagueTeamStats(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
