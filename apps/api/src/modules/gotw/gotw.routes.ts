import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { createGotwPoll, getActiveGotwPoll, getActiveGotwPolls, getGotwGameResult, settleGotwPoll } from "./gotw.service.js";

export async function gotwRoutes(app: FastifyInstance) {
  app.post("/v1/gotw/poll/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        gameId: z.string().uuid(),
        awayTeamId: z.string().uuid(),
        homeTeamId: z.string().uuid(),
        awayUserId: z.string().uuid().nullable().optional(),
        homeUserId: z.string().uuid().nullable().optional(),
        awayTeamName: z.string().min(1),
        homeTeamName: z.string().min(1),
        discordChannelId: z.string().min(1),
        discordMessageId: z.string().min(1),
        weekNumber: z.number().int().min(1),
        expiresAt: z.string().min(1),
      }).parse(request.body);
      return reply.send(await createGotwPoll(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/gotw/poll/active", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId, weekNumber } = z.object({
        guildId: z.string().min(1),
        weekNumber: z.number().int().min(1),
      }).parse(request.body);
      return reply.send(await getActiveGotwPoll(guildId, weekNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/gotw/poll/active-all", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId, weekNumber } = z.object({
        guildId: z.string().min(1),
        weekNumber: z.number().int().min(1),
      }).parse(request.body);
      return reply.send({ polls: await getActiveGotwPolls(guildId, weekNumber) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/gotw/poll/settle", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        pollId: z.string().uuid(),
        winningTeamId: z.string().uuid().nullable(),
        voters: z.array(z.object({
          discordId: z.string().min(1),
          userId: z.string().uuid().nullable().optional(),
          selectedTeamId: z.string().uuid(),
        })),
      }).parse(request.body);
      return reply.send(await settleGotwPoll(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/gotw/poll/game-result", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        awayTeamId: z.string().uuid(),
        homeTeamId: z.string().uuid(),
        weekNumber: z.number().int().min(1),
      }).parse(request.body);
      return reply.send(await getGotwGameResult(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
