import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getUserBaselineByDiscordId, getWalletByDiscordId } from "./user.service.js";
export async function userRoutes(app: FastifyInstance) {
  app.get("/v1/users/:discordId/baseline", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; return reply.send(await getUserBaselineByDiscordId(discordId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/users/:discordId/wallet", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; return reply.send(await getWalletByDiscordId(discordId)); } catch (error) { return sendError(reply, error); }});
}
