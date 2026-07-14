import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { createTransferEntry, deleteTransferEntry, listTransferEntries, updateTransferStatus } from "./transfer-portal.service.js";

export async function transferPortalRoutes(app: FastifyInstance) {
  app.post("/v1/transfer-portal/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listTransferEntries(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/transfer-portal/create", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), playerName: z.string().trim().min(1).max(80), position: z.string().trim().min(1).max(20),
        classYear: z.enum(["freshman", "sophomore", "junior", "senior"]).optional().nullable(),
        originTeamId: z.string().uuid(), entryDate: z.string().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      const discordId = auth.mode === "user" ? auth.discordId : "commissioner-manual-entry";
      return reply.send(await createTransferEntry({ ...body, discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/transfer-portal/update-status", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), id: z.string().uuid(), status: z.enum(["entered_portal", "transferred", "withdrawn"]),
        destinationTeamId: z.string().uuid().optional().nullable(), destinationTeamExternal: z.string().trim().max(120).optional().nullable(),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await updateTransferStatus(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/transfer-portal/delete", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), id: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await deleteTransferEntry(body));
    } catch (error) { return sendError(reply, error); }
  });
}
