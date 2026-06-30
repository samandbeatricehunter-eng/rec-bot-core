import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { setLeagueWeek, viewLeagueWeek } from "./league-week.service.js";
import { completeAdvanceWeek, getAdvanceWeekGames, getDivisionWinnerOptions, listAdvanceGameStories, markAdvanceGameStoryPosted, saveDivisionWinners, setNextAdvanceTime } from "./advance-results.service.js";
import { issueEosPayoutBatch, listEosPayoutBatch, prepareEosPayouts, projectEosPayouts, reviewEosPayoutItem, reviewEosPayoutsForUser } from "./eos-payouts.service.js";
import { cancelOpenEosAwardPolls, listOpenEosAwardPolls, listSettledEosAwards, prepareEosAwardNominees, recordEosAwardPoll, settleEosAwardPoll } from "./eos-awards.service.js";
import { createWeeklyScoreReview, getWeeklyScoreReview, correctWeeklyScoreReview, approveWeeklyScoreReview, cancelWeeklyScoreReview } from "./weekly-scores.service.js";
import { generateAdvanceDms } from "./advance-dm.service.js";
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

  // Parse a League Schedule screenshot into a persisted, correctable weekly-scores
  // review (supersedes any prior pending review for the week).
  app.post("/v1/league-week/weekly-scores/review/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        weekNumber: z.number().int().min(1).max(22).optional().nullable(),
        imageUrls: z.array(z.string().url()).min(1).max(2),
        createdByDiscordId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await createWeeklyScoreReview(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/weekly-scores/review/get", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { reviewId } = z.object({ reviewId: z.string().uuid() }).parse(request.body);
      return reply.send(await getWeeklyScoreReview(reviewId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/weekly-scores/review/correct", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        reviewId: z.string().uuid(),
        gameId: z.string().uuid(),
        awayScore: z.number().int().min(0).max(200).nullable(),
        homeScore: z.number().int().min(0).max(200).nullable(),
      }).parse(request.body);
      return reply.send(await correctWeeklyScoreReview(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/weekly-scores/review/approve", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        reviewId: z.string().uuid(),
        loggedByDiscordId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await approveWeeklyScoreReview(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/weekly-scores/review/cancel", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { reviewId } = z.object({ reviewId: z.string().uuid() }).parse(request.body);
      return reply.send(await cancelWeeklyScoreReview(reviewId));
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
        includePosted: z.boolean().optional(),
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

  app.post("/v1/league-week/advance-dms", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await generateAdvanceDms(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/prepare", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        requestedByDiscordId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await prepareEosPayouts(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/project", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await projectEosPayouts(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/list", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ batchId: z.string().uuid() }).parse(request.body);
      return reply.send(await listEosPayoutBatch(body.batchId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/review", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        itemId: z.string().uuid(),
        action: z.enum(["approve", "deny"]),
        reviewedByDiscordId: z.string().min(1),
        deniedReason: z.string().optional().nullable(),
      }).parse(request.body);
      return reply.send(await reviewEosPayoutItem(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/review-user", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        batchId: z.string().uuid(),
        userId: z.string().uuid(),
        action: z.enum(["approve", "deny"]),
        reviewedByDiscordId: z.string().min(1),
        deniedReason: z.string().optional().nullable(),
      }).parse(request.body);
      return reply.send(await reviewEosPayoutsForUser(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/issue-batch", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        batchId: z.string().uuid(),
        reviewedByDiscordId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await issueEosPayoutBatch(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/prepare", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await prepareEosAwardNominees(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/record-poll", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        categoryKey: z.string().min(1),
        discordChannelId: z.string().min(1),
        discordMessageId: z.string().min(1),
        closesAt: z.string().min(1),
        nominees: z.array(z.any()),
      }).parse(request.body);
      return reply.send(await recordEosAwardPoll(body as any));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/open", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await listOpenEosAwardPolls());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/cancel-open", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await cancelOpenEosAwardPolls(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/settle", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ pollId: z.string().uuid(), voteCounts: z.record(z.string(), z.number()), discordMessageId: z.string().optional().nullable() }).parse(request.body);
      return reply.send(await settleEosAwardPoll(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/settled", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), seasonNumber: z.number().int().optional().nullable() }).parse(request.body);
      return reply.send(await listSettledEosAwards(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
