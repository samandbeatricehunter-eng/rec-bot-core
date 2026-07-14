import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { setLeagueWeek, viewLeagueWeek } from "./league-week.service.js";
import { completeAdvanceWeek, getAdvanceWeekGames, getDivisionWinnerOptions, getWeeklyH2hGames, listAdvanceGameStories, markAdvanceGameStoryPosted, saveDivisionWinners, setNextAdvanceTime } from "./advance-results.service.js";
import { issueEosPayoutBatch, listEosPayoutBatch, prepareEosPayouts, projectEosPayouts, reviewEosPayoutItem, reviewEosPayoutsForUser } from "./eos-payouts.service.js";
import { cancelOpenEosAwardPolls, getEosAwardPoll, listOpenEosAwardPolls, listSettledEosAwards, prepareEosAwardNominees, recordEosAwardPoll, settleEosAwardPoll } from "./eos-awards.service.js";
import { createWeeklyScoreReview, getWeeklyScoreReview, correctWeeklyScoreReview, approveWeeklyScoreReview, cancelWeeklyScoreReview } from "./weekly-scores.service.js";
import { listManualScoreGames, recordManualGameResult } from "./manual-scores.service.js";
import { generateAdvanceDms } from "./advance-dm.service.js";
import { SUPPORTED_TZ_LABELS } from "../../lib/timezone.js";
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { sendDiscordChannelMessage, sendDiscordDirectMessage } from "../../lib/discord-guild.js";

async function relayWebAdvanceToDiscord(guildId: string, weekNumber: number, seasonStage: string) {
  const [context, dmPayload] = await Promise.all([getCurrentLeagueContext(guildId), generateAdvanceDms({ guildId })]);
  const announcementChannelId = String((context.routes as any)?.announcements_channel_id ?? "");
  const announcement = announcementChannelId
    ? await sendDiscordChannelMessage(announcementChannelId, `@everyone **REC has advanced to Week ${weekNumber}** (${seasonStage.replace(/_/g, " ")}). Check the Hub and your game channel for this week's matchup.`, true).then(() => true).catch(() => false)
    : false;
  const deliveries = await Promise.allSettled(dmPayload.users.map((user) => {
    const sections = [user.sections.transactions, user.sections.badges, user.sections.eosProgress, user.sections.powerRanking].filter(Boolean);
    return sendDiscordDirectMessage(user.discordId, `**REC Weekly Advance — Week ${weekNumber}**\n${sections.length ? sections.join("\n\n") : "Your league has advanced. Check the Hub for your latest matchup and league updates."}`);
  }));
  return { announcementPosted: announcement, dmsSent: deliveries.filter((item) => item.status === "fulfilled").length, dmsFailed: deliveries.filter((item) => item.status === "rejected").length };
}

// EOS award polls are fetched/settled by pollId, not guildId, so the combined guard's usual
// "claimed guildId matches session" check only proves the caller belongs to *some* guild —
// it doesn't prove the poll itself belongs to that guild. Mirrors box-score.routes.ts's
// assertSubmissionInSessionGuild: 404 rather than 403 on mismatch so a guessed UUID from
// another guild doesn't confirm its own existence.
async function assertEosAwardPollInSessionGuild(guildId: string, pollLeagueId: string) {
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== pollLeagueId) throw new ApiError(404, "Poll not found.");
}

const ViewLeagueWeekSchema = z.object({
  guildId: z.string().min(1)
});

const SetLeagueWeekSchema = z.object({
  guildId: z.string().min(1),
  // 0 is a valid CFB week (Week 0, before Week 1); Madden never uses it.
  weekNumber: z.number().int().min(0).max(30),
  seasonStage: z.string().min(1),
  seasonNumber: z.number().int().min(1).optional()
});

export async function leagueWeekRoutes(app: FastifyInstance) {
  app.post("/v1/league-week/view", async (request, reply) => {
    try {
      const { guildId } = ViewLeagueWeekSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await viewLeagueWeek(guildId));
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
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await getAdvanceWeekGames(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Home page's read-only weekly H2H panel — member-permission (unlike the commissioner-
  // only Advance wizard above), no game-input gating, just this week's matchups + status.
  app.post("/v1/league-week/weekly-h2h", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getWeeklyH2hGames(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/advance-complete", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        nextWeekNumber: z.number().int().min(0).max(30),
        nextSeasonStage: z.string().min(1),
        advancedByDiscordId: z.string().min(1),
        results: z.array(z.object({
          gameId: z.string().uuid(),
          outcome: z.enum(["home", "away", "tie"]),
          homeScore: z.number().int().min(0).max(200).optional().nullable(),
          awayScore: z.number().int().min(0).max(200).optional().nullable(),
        })),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode === "user") body.advancedByDiscordId = auth.discordId;
      const result = await completeAdvanceWeek(body);
      const discord = auth.mode === "user"
        ? await relayWebAdvanceToDiscord(body.guildId, body.nextWeekNumber, body.nextSeasonStage).catch((error) => ({ announcementPosted: false, dmsSent: 0, dmsFailed: 0, error: error instanceof Error ? error.message : "Discord relay failed." }))
        : null;
      return reply.send({ ...result, discord });
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
        weekNumber: z.number().int().min(0).max(22).optional().nullable(),
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
      // guildId is optional because the bot's existing calls don't send it (bot-mode auth
      // never checks it — see resolveGuildId below); the web dashboard always sends it.
      const body = z.object({
        guildId: z.string().min(1).optional(),
        reviewId: z.string().uuid(),
        loggedByDiscordId: z.string().min(1),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") body.loggedByDiscordId = auth.discordId;
      return reply.send(await approveWeeklyScoreReview(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/weekly-scores/review/cancel", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1).optional(), reviewId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      return reply.send(await cancelWeeklyScoreReview(body.reviewId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/manual-scores/games", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), weekNumber: z.number().int().min(0).max(22).optional().nullable() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listManualScoreGames(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/manual-scores/record", async (request, reply) => {
    try {
      const OptionalStat = z.number().min(0).max(100000).optional().nullable();
      const TeamManualStats = z.object({
        offYardsGained: OptionalStat, offRushYards: OptionalStat, offPassYards: OptionalStat, offFirstDown: OptionalStat,
        puntReturnYards: OptionalStat, kickReturnYards: OptionalStat, totalYardsGained: OptionalStat, turnoversCommitted: OptionalStat,
        redZoneOffPercentage: z.number().min(0).max(100).optional().nullable(), generatedTurnovers: OptionalStat, yardsAllowed: OptionalStat,
        rushYardsAllowed: OptionalStat, passYardsAllowed: OptionalStat, firstDownsAllowed: OptionalStat, redZoneDefPercentage: z.number().min(0).max(100).optional().nullable(),
        thirdDownConversions: OptionalStat, fourthDownConversions: OptionalStat, twoPointConversions: OptionalStat,
        comebackDeficit: OptionalStat, comebackDeficitQuarter: z.number().int().min(1).max(5).optional().nullable(), comebackRate: OptionalStat,
        fourthQuarterComeback: z.boolean().optional(), quarterScores: z.array(z.number().int().min(0).max(100)).max(8).optional(),
      });
      const PerformanceTag = z.object({
        subjectType: z.enum(["player", "unit"]),
        watchedPlayerId: z.string().uuid().optional().nullable(),
        unit: z.enum(["offense", "defense", "special_teams"]).optional().nullable(),
        statLines: z.array(z.object({ statKey: z.string().min(1), label: z.string().min(1), value: z.number() })).max(20).optional(),
        performanceGrade: z.enum(["standout", "solid", "neutral", "poor"]),
      });
      const body = z.object({
        guildId: z.string().min(1),
        gameId: z.string().uuid(),
        outcome: z.enum(["home", "away", "tie"]),
        homeScore: z.number().int().min(0).max(200).optional().nullable(),
        awayScore: z.number().int().min(0).max(200).optional().nullable(),
        submittedByDiscordId: z.string().optional().nullable(),
        manualStats: z.object({ home: TeamManualStats.optional(), away: TeamManualStats.optional() }).optional().nullable(),
        performanceTags: z.object({ home: z.array(PerformanceTag).max(30).optional(), away: z.array(PerformanceTag).max(30).optional() }).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") body.submittedByDiscordId = auth.discordId;
      return reply.send(await recordManualGameResult(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/division-winner-options", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await getDivisionWinnerOptions(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/division-winners", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().min(1),
        selectedByDiscordId: z.string().min(1),
        winners: z.array(z.object({
          divisionKey: z.string().min(1),
          teamId: z.string().uuid(),
        })).min(1),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode === "user") body.selectedByDiscordId = auth.discordId;
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
        weekNumber: z.number().int().min(0).max(30),
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
      const body = z.object({
        guildId: z.string().min(1),
        year: z.number().int().min(2026).max(2100),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59).default(0),
        tzLabel: z.enum(SUPPORTED_TZ_LABELS as [string, ...string[]]),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await setNextAdvanceTime(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Preview-only — this generates the per-coach DM text but does not send it. Actual
  // delivery requires the bot's discordUser.send(), so this route is only useful for a web
  // "here's what would be sent" view; the send action itself stays Discord-only.
  app.post("/v1/league-week/advance-dms", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await generateAdvanceDms(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-payouts/prepare", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        requestedByDiscordId: z.string().min(1),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") body.requestedByDiscordId = auth.discordId;
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
      // guildId is optional because the bot's existing calls don't send it (bot-mode auth
      // never checks it — see resolveGuildId below); the web dashboard always sends it.
      const body = z.object({
        guildId: z.string().min(1).optional(),
        batchId: z.string().uuid(),
        reviewedByDiscordId: z.string().min(1),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") body.reviewedByDiscordId = auth.discordId;
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

  app.post("/v1/league-week/eos-awards/get", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      const result = await getEosAwardPoll(body.pollId);
      if (auth.mode === "user") await assertEosAwardPollInSessionGuild(auth.guildId, result.poll.league_id);
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-week/eos-awards/settle", async (request, reply) => {
    try {
      // guildId is optional because the bot's existing calls don't send it (bot-mode auth
      // never checks it — see resolveGuildId below); the web dashboard always sends it.
      const body = z.object({
        guildId: z.string().min(1).optional(),
        pollId: z.string().uuid(),
        voteCounts: z.record(z.string(), z.number()),
        voterDiscordIds: z.record(z.string(), z.array(z.string())).optional(),
        discordMessageId: z.string().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") {
        const existing = await getEosAwardPoll(body.pollId);
        await assertEosAwardPollInSessionGuild(auth.guildId, existing.poll.league_id);
      }
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
