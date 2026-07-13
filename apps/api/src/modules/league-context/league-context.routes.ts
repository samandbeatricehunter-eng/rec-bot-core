import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getLeagueHeaderSummary } from "./league-context.service.js";

export async function leagueContextRoutes(app: FastifyInstance) {
  // Web dashboard's header bar — league name/password/season/week/team-count, plus whether
  // the caller is the guild owner (gates the floating Delete League button). Browser-only:
  // the bot has no need for this, and isGuildOwner needs a real discordId.
  app.post("/v1/league-context/header", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Header summary is a browser-only endpoint.");
      return reply.send(await getLeagueHeaderSummary(guildId, auth.discordId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
