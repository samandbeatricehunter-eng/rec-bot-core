import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getLeagueRecords } from "./league-records.service.js";

const CATEGORY_KEYS = ["passing", "rushing", "receiving", "blocking", "defense", "special_teams"] as const;

export async function leagueRecordsRoutes(app: FastifyInstance) {
  app.post("/v1/hub/league-records", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        scope: z.enum(["game", "season", "career"]),
        postseason: z.boolean().default(false),
        category: z.enum(CATEGORY_KEYS),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getLeagueRecords(body.guildId, body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
