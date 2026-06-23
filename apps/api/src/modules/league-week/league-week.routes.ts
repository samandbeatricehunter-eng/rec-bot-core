import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { setLeagueWeek, viewLeagueWeek } from "./league-week.service.js";
import { completeAdvanceWeek, getAdvanceWeekGames, setNextAdvanceTime } from "./advance-results.service.js";
import { SUPPORTED_TZ_LABELS } from "../../lib/timezone.js";

const ViewLeagueWeekSchema = z.object({
  guildId: z.string().min(1)
});

const SetLeagueWeekSchema = z.object({
  guildId: z.string().min(1),
  weekNumber: z.number().int().min(1).max(30),
  seasonStage: z.string().min(1),
  seasonNumber: z.number().int().min(1).optional()
});

export async function leagueWeekRoutes(app: FastifyInstance) {
  app.post("/v1/league-week/view", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await viewLeagueWeek(ViewLeagueWeekSchema.parse(request.body).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/set", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await setLeagueWeek(SetLeagueWeekSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/advance-games", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await getAdvanceWeekGames(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/advance-complete", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        nextWeekNumber: z.number().int().min(1).max(30),
        nextSeasonStage: z.string().min(1),
        advancedByDiscordId: z.string().min(1),
        results: z.array(z.object({
          gameId: z.string().uuid(),
          outcome: z.enum(["home", "away", "tie"]),
        })),
      }).parse(request.body);
      return reply.send(await completeAdvanceWeek(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/set-next-advance", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        year: z.number().int().min(2026).max(2100),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59).default(0),
        tzLabel: z.enum(SUPPORTED_TZ_LABELS as [string, ...string[]]),
      }).parse(request.body);
      return reply.send(await setNextAdvanceTime(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
