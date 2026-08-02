import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { addHeismanCandidate, listHeismanCandidates, removeHeismanCandidate } from "./heisman.service.js";

export async function heismanRoutes(app: FastifyInstance) {
  app.post("/v1/heisman/list", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "member" });
      const input = z.object({ guildId: z.string().min(1), seasonNumber: z.number().int().positive().optional().nullable() }).parse(request.body);
      return reply.send(await listHeismanCandidates(input));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/heisman/add", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
        playerName: z.string().trim().min(1).max(100),
        teamId: z.string().uuid().optional().nullable(),
      }).parse(request.body);
      return reply.send(await addHeismanCandidate({ ...input, requestedByDiscordId: auth.mode === "user" ? auth.discordId : null }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/heisman/remove", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const input = z.object({ guildId: z.string().min(1), candidateId: z.string().uuid() }).parse(request.body);
      return reply.send(await removeHeismanCandidate(input));
    } catch (error) { return sendError(reply, error); }
  });
}
