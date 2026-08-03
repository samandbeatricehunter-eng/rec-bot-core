import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { getTeamRoster } from "./roster.service.js";

export async function teamRosterRoutes(app: FastifyInstance) {
  app.post("/v1/roster/team", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        teamId: z.string().uuid().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await getTeamRoster({ guildId: body.guildId, discordId: body.discordId, teamId: body.teamId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
