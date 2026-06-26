import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { setLeagueWeek, viewLeagueWeek } from "./league-week.service.js";
import { completeAdvanceWeek, getAdvanceWeekGames, getDivisionWinnerOptions, listAdvanceGameStories, markAdvanceGameStoryPosted, saveDivisionWinners, setNextAdvanceTime } from "./advance-results.service.js";
import { previewWeeklyScores, prelogWeeklyScores } from "./weekly-scores.service.js";
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
          homeScore: z.number().int().min(0).max(200).optional().nullable(),
          awayScore: z.number().int().min(0).max(200).optional().nullable(),
        })),
      }).parse(request.body);
      return reply.send(await completeAdvanceWeek(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Parse a League Schedule screenshot for the week's final scores (no DB write).
  app.post("/v1/league-week/weekly-scores/preview", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        weekNumber: z.number().int().min(1).max(22).optional().nullable(),
        imageUrls: z.array(z.string().url()).min(1).max(2),
      }).parse(request.body);
      return reply.send(await previewWeeklyScores(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Pre-log the (possibly corrected) weekly scores to rec_game_results.
  app.post("/v1/league-week/weekly-scores/prelog", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        weekNumber: z.number().int().min(1).max(22),
        loggedByDiscordId: z.string().min(1),
        games: z.array(z.object({
          gameId: z.string().uuid(),
          awayScore: z.number().int().min(0).max(200).nullable(),
          homeScore: z.number().int().min(0).max(200).nullable(),
        })).min(1),
      }).parse(request.body);
      return reply.send(await prelogWeeklyScores(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/division-winner-options", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await getDivisionWinnerOptions(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/division-winners", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().min(1),
        selectedByDiscordId: z.string().min(1),
        winners: z.array(z.object({
          divisionKey: z.string().min(1),
          teamId: z.string().uuid(),
        })).min(1),
      }).parse(request.body);
      return reply.send(await saveDivisionWinners(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/advance-stories", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().min(1),
        weekNumber: z.number().int().min(1).max(30),
      }).parse(request.body);
      return reply.send(await listAdvanceGameStories(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/advance-stories/posted", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        storyId: z.string().uuid(),
        channelId: z.string().min(1),
        messageId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await markAdvanceGameStoryPosted(body));
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
