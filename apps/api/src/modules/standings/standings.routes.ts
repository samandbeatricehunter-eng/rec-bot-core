import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { getLatestNflPlayoffBracketSnapshot, getNflPlayoffPicture } from "./nfl-bracket.service.js";

export async function standingsRoutes(app: FastifyInstance) {
  app.post("/v1/standings/nfl-playoff-picture", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "member" });
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      const context = await getCurrentLeagueContext(input.guildId);
      if (!String(context.rec_leagues.game ?? "").startsWith("madden")) {
        throw new ApiError(400, "The NFL playoff bracket is available for Madden leagues only.");
      }
      const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
      return reply.send(await getNflPlayoffPicture(context.leagueId, seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/standings/nfl-playoff-bracket-snapshot", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "member" });
      const input = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const context = await getCurrentLeagueContext(input.guildId);
      if (!String(context.rec_leagues.game ?? "").startsWith("madden")) {
        throw new ApiError(400, "The NFL playoff bracket is available for Madden leagues only.");
      }
      return reply.send(await getLatestNflPlayoffBracketSnapshot(context.leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
