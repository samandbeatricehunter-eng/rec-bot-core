import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { listReversibleTransactions, reverseTransaction } from "./admin-economy.service.js";

// Site-only now — this used to be reachable by the bot on the internal API key alone (no
// verification that the Discord user who clicked a button was actually a commissioner of this
// specific league, beyond a client-side Discord-role check the bot did before calling). The
// Discord "Reverse Transaction" flow has been removed; requireBotOrUserSession's co_commissioner
// check here is what actually verifies the caller against the league's own commissioner records.
export async function adminEconomyRoutes(app: FastifyInstance) {
  app.post("/v1/admin-economy/reversible-transactions", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "This tool is available on the REC website only.");
      return reply.send(await listReversibleTransactions(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/admin-economy/reverse-transaction", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        ledgerId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "This tool is available on the REC website only.");
      return reply.send(await reverseTransaction({ ...body, requestedByDiscordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
