import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { createLegendPurchaseRequest, listLeagueLegendAvailability, listLegendCatalog } from "./legends.service.js";

export async function legendRoutes(app: FastifyInstance) {
  app.post("/v1/legends/catalog", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listLegendCatalog(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/legends/availability", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listLeagueLegendAvailability(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/legends/purchase", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        legendId: z.string().uuid(),
        replacePlayerRequest: z.string().max(80).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "user") body.discordId = auth.discordId;
      return reply.send(await createLegendPurchaseRequest(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
