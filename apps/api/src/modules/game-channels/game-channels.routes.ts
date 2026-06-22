import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { listTrackedGameChannelDiscordIds, markTrackedGameChannelsDeleted, registerGameChannel } from "./game-channels.service.js";

export async function gameChannelRoutes(app: FastifyInstance) {
  app.post("/v1/game-channels/tracked", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send({ discordChannelIds: await listTrackedGameChannelDiscordIds(guildId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/register", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        gameId: z.string().uuid().optional().nullable(),
        discordChannelId: z.string().min(1),
        seasonNumber: z.number().int().positive(),
        weekNumber: z.number().int().positive(),
        awayTeamId: z.string().uuid().optional().nullable(),
        homeTeamId: z.string().uuid().optional().nullable(),
        awayUserId: z.string().uuid().optional().nullable(),
        homeUserId: z.string().uuid().optional().nullable(),
      }).parse(request.body);
      return reply.send({ gameChannel: await registerGameChannel(input) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/mark-deleted", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { discordChannelIds } = z.object({
        discordChannelIds: z.array(z.string().min(1)),
      }).parse(request.body);
      return reply.send(await markTrackedGameChannelsDeleted(discordChannelIds));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
