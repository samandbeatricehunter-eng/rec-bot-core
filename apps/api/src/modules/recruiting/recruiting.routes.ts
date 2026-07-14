import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { createRecruit, deleteRecruit, listRecruits, updateRecruitStatus } from "./recruiting.service.js";

export async function recruitingRoutes(app: FastifyInstance) {
  app.post("/v1/recruiting/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listRecruits(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/recruiting/create", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), playerName: z.string().trim().min(1).max(80), position: z.string().trim().min(1).max(20),
        homeCity: z.string().trim().max(80).optional().nullable(), homeState: z.string().trim().max(40).optional().nullable(),
        starRating: z.number().int().min(1).max(5),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      const discordId = auth.mode === "user" ? auth.discordId : "commissioner-manual-entry";
      return reply.send(await createRecruit({ ...body, discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/recruiting/update-status", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), id: z.string().uuid(), status: z.enum(["uncommitted", "committed", "decommitted"]),
        committedTeamId: z.string().uuid().optional().nullable(), committedTeamExternal: z.string().trim().max(120).optional().nullable(),
        commitDate: z.string().optional().nullable(),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await updateRecruitStatus(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/recruiting/delete", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), id: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await deleteRecruit(body));
    } catch (error) { return sendError(reply, error); }
  });
}
