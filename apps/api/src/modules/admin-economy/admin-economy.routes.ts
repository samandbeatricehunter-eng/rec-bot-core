import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { listReversibleTransactions, reverseTransaction } from "./admin-economy.service.js";

export async function adminEconomyRoutes(app: FastifyInstance) {
  app.post("/v1/admin-economy/reversible-transactions", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1) }).parse(request.body);
      return reply.send(await listReversibleTransactions(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin-economy/reverse-transaction", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        ledgerId: z.string().uuid(),
        requestedByDiscordId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await reverseTransaction(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
