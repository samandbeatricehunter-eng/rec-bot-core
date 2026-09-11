import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getMyWeeklyTeamChallenges } from "./weekly-challenge-issuance.service.js";
import { getPlayerXpState } from "../player-xp/player-xp-ledger.service.js";

const GuildBody = z.object({ guildId: z.string().min(1), discordId: z.string().optional() });

export async function weeklyChallengesRoutes(app: FastifyInstance) {
  app.post("/v1/weekly-challenges/mine", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      const discordId = auth.mode === "user" ? auth.discordId : body.discordId;
      if (!discordId) throw new ApiError(400, "discordId is required for bot-mode calls.");
      return reply.send(await getMyWeeklyTeamChallenges({ guildId: body.guildId, discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/player-xp/state", async (request, reply) => {
    try {
      const body = GuildBody.extend({ playerId: z.string().min(1) }).parse(request.body);
      const { getCurrentLeagueContext } = await import("../league-context/league-context.service.js");
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      const context = await getCurrentLeagueContext(body.guildId);
      return reply.send(await getPlayerXpState(context.leagueId, body.playerId));
    } catch (error) { return sendError(reply, error); }
  });
}
