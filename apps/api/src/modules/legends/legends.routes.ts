import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { createLegendPurchaseRequest, listLeagueLegendAvailability, listLegendCatalog } from "./legends.service.js";

export async function legendRoutes(app: FastifyInstance) {
  app.post("/v1/legends/catalog", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await listLegendCatalog());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/legends/availability", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await listLeagueLegendAvailability(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/legends/purchase", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        legendId: z.string().uuid(),
      }).parse(request.body);
      return reply.send(await createLegendPurchaseRequest(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
