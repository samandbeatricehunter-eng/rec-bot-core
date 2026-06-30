import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getGameWagerOptions } from "./odds.service.js";
import {
  attachWagerPendingMessage,
  cancelWager,
  getWagerResolvability,
  listConfirmableWagers,
  listWagerableGames,
  placeHouseWager,
  settleWager,
} from "./wagers.service.js";

export async function wagerRoutes(app: FastifyInstance) {
  app.post("/v1/wagers/games", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1) }).parse(request.body);
      return reply.send(await listWagerableGames(body.guildId, body.discordId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/options", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid() }).parse(request.body);
      return reply.send(await getGameWagerOptions(body.guildId, body.gameId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/place-house", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        gameId: z.string().uuid(),
        market: z.string().min(1),
        pick: z.string().min(1),
        stake: z.number().int().positive(),
      }).parse(request.body);
      return reply.send(await placeHouseWager(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/attach-message", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ wagerId: z.string().uuid(), channelId: z.string().min(1), messageId: z.string().min(1) }).parse(request.body);
      return reply.send(await attachWagerPendingMessage(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/settle", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ wagerId: z.string().uuid(), reviewedByDiscordId: z.string().min(1) }).parse(request.body);
      return reply.send(await settleWager(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/cancel", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ wagerId: z.string().uuid() }).parse(request.body);
      return reply.send(await cancelWager(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/confirmable", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const context = await getCurrentLeagueContext(body.guildId);
      return reply.send(await listConfirmableWagers(context.leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/wagers/resolvability", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), wagerId: z.string().uuid() }).parse(request.body);
      const context = await getCurrentLeagueContext(body.guildId);
      return reply.send(await getWagerResolvability(context.leagueId, body.wagerId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
