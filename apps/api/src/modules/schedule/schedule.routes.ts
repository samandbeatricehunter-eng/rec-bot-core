import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { listScheduleSeason, listScheduleTeams, listScheduleWeek, previewScheduleImport, replaceScheduleWeek, saveManualScheduleGame, seedDefaultScheduleForGuild } from "./schedule.service.js";
import { computeLeagueSos } from "./sos.service.js";
import { computePowerRankings } from "./power-rankings.service.js";

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

  app.post("/v1/schedule/sos", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        discordId: z.string().optional().nullable(),
      }).parse(request.body);
      return reply.send(await computeLeagueSos(input.guildId, input.discordId ?? null));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/power-rankings", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        discordId: z.string().optional().nullable(),
        completedWeekNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await computePowerRankings(input.guildId, input.discordId ?? null, { completedWeekNumber: input.completedWeekNumber ?? null }));
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

  app.post("/v1/schedule/seed-default", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        requestedByDiscordId: z.string().optional().nullable(),
        force: z.boolean().optional(),
      }).parse(request.body);
      return reply.send(await seedDefaultScheduleForGuild(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Parse a League Schedule screenshot into matchups matched to league teams (no DB write).
  app.post("/v1/schedule/import-preview", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        // Allow playoff weeks (19–22), not just the regular season.
        weekNumber: z.number().int().min(1).max(22),
        imageUrls: z.array(z.string().url()).min(1).max(2),
      }).parse(request.body);
      return reply.send(await previewScheduleImport(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/replace-week", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
        weekNumber: z.number().int().positive(),
        games: z.array(z.object({
          awayTeamId: z.string().uuid(),
          homeTeamId: z.string().uuid(),
        })).min(1),
        requestedByDiscordId: z.string().optional().nullable(),
      }).parse(request.body);
      return reply.send(await replaceScheduleWeek(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
