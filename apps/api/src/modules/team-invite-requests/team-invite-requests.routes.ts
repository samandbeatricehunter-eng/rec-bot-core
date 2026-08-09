import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getGameInviteRequestStatus, requestGameInvite, resolveGameInviteRequest } from "./team-invite-requests.service.js";

export async function teamInviteRequestsRoutes(app: FastifyInstance) {
  app.post("/v1/team-invite-requests/status", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Checking invite request status requires a website session.");
      return reply.send(await getGameInviteRequestStatus(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/team-invite-requests/create", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), tag: z.string().min(1).max(40) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Requesting a game invite requires a website session.");
      return reply.send(await requestGameInvite({ guildId: body.guildId, discordId: auth.discordId, tag: body.tag }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/team-invite-requests/resolve", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        leagueId: z.string().uuid().optional().nullable(),
        requestId: z.string().uuid(),
        action: z.enum(["sent", "cannot_send", "rejected"]),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Resolving an invite request requires a commissioner session.");
      return reply.send(await resolveGameInviteRequest({
        requestId: body.requestId,
        leagueId: body.leagueId,
        action: body.action,
        reviewerDiscordId: auth.discordId,
      }));
    } catch (error) { return sendError(reply, error); }
  });
}
