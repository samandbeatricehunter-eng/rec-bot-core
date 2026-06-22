import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { listScheduleSeason, listScheduleTeams, listScheduleWeek, saveManualScheduleGame } from "./schedule.service.js";

const GuildSchema = z.object({ guildId: z.string().min(1) });

const WeekSchema = z.object({
  guildId: z.string().min(1),
  seasonNumber: z.number().int().positive().optional().nullable(),
  weekNumber: z.number().int().positive(),
});

const SaveManualGameSchema = z.object({
  guildId: z.string().min(1),
  seasonNumber: z.number().int().positive().optional().nullable(),
  weekNumber: z.number().int().positive(),
  slotNumber: z.number().int().positive(),
  awayTeamId: z.string().uuid(),
  homeTeamId: z.string().uuid(),
  requestedByDiscordId: z.string().optional().nullable(),
});

export async function scheduleRoutes(app: FastifyInstance) {
  app.post("/v1/schedule/teams", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = GuildSchema.parse(request.body);
      return reply.send(await listScheduleTeams(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/week", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = WeekSchema.parse(request.body);
      return reply.send(await listScheduleWeek(input.guildId, input.weekNumber, input.seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/season", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await listScheduleSeason(input.guildId, input.seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/manual-game", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await saveManualScheduleGame(SaveManualGameSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
