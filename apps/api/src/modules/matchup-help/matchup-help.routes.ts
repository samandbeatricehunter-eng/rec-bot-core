import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { submitMatchupHelpRequest } from "./matchup-help.service.js";

export async function matchupHelpRoutes(app: FastifyInstance) {
  app.post("/v1/matchup-help/submit", async (request, reply) => {
    try {
      const body = z
        .object({
          guildId: z.string().min(1),
          gameId: z.string().uuid(),
          kind: z.enum(["force_win", "autopilot", "matchup_issue"]),
          message: z.string().trim().min(1).max(500),
        })
        .parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Request Help requires a user session."));
      return reply.send(
        await submitMatchupHelpRequest({
          guildId: body.guildId,
          discordId: auth.discordId,
          gameId: body.gameId,
          kind: body.kind,
          message: body.message,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
