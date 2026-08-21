import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { reviewForceWinRequest } from "../scheduling/matchup-scheduling.service.js";
import {
  addCaseMemo,
  getCommissionerPendingSummaryForLeague,
  linkCaseToVotingTopic,
  listCaseEvents,
  listCommissionerNotifications,
  listCompletedCommissionerTransactions,
  listUnattendedCommissionerNotifications,
  markCommissionerInboxItemHandled,
  markCommissionerLeagueViewed,
  markCommissionerNotificationsDmSent,
  setCaseAwaitingUserResponse,
} from "./notifications.service.js";

const ListSchema = z.object({
  guildId: z.string().min(1),
  // Set by the bot's polling loop (1e) to fetch only items created since its last check;
  // omitted by the web dashboard, which always wants the full pending list.
  sinceIso: z.string().datetime().optional().nullable(),
});

const LeagueScopedSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  leagueId: z.string().uuid(),
});

export async function notificationsRoutes(app: FastifyInstance) {
  app.post("/v1/notifications/list", async (request, reply) => {
    try {
      const body = ListSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listCommissionerNotifications(body.guildId, body.sinceIso));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/notifications/pending-summary", async (request, reply) => {
    try {
      const body = LeagueScopedSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send({ summary: await getCommissionerPendingSummaryForLeague(body.discordId, body.leagueId) });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/mark-viewed", async (request, reply) => {
    try {
      const body = LeagueScopedSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await markCommissionerLeagueViewed(body.discordId, body.leagueId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/completed", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listCompletedCommissionerTransactions(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/dm-pending", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await listUnattendedCommissionerNotifications(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/dm-mark", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), ids: z.array(z.string().uuid()).max(200) }).parse(request.body);
      return reply.send(await markCommissionerNotificationsDmSent(body.guildId, body.ids));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/mark-handled", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), inboxId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Marking an item handled requires a user session."));
      return reply.send(await markCommissionerInboxItemHandled({ guildId: body.guildId, inboxId: body.inboxId, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/force-win-review", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), inboxId: z.string().uuid(),
        decision: z.enum(["approve", "deny"]), reason: z.string().trim().max(500).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Reviewing a Force Win request requires a user session."));
      return reply.send(await reviewForceWinRequest({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/case/memo", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), inboxId: z.string().uuid(), memo: z.string().max(2000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Saving a memo requires a user session."));
      return reply.send(await addCaseMemo({ guildId: body.guildId, inboxId: body.inboxId, memo: body.memo }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/case/events", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), inboxId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listCaseEvents(body.guildId, body.inboxId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/case/link-vote", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), inboxId: z.string().uuid(), topicId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Linking a vote requires a user session."));
      return reply.send(await linkCaseToVotingTopic({ guildId: body.guildId, inboxId: body.inboxId, topicId: body.topicId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/notifications/case/awaiting-user", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), inboxId: z.string().uuid(), awaiting: z.boolean() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Updating a case requires a user session."));
      return reply.send(await setCaseAwaitingUserResponse({ guildId: body.guildId, inboxId: body.inboxId, awaiting: body.awaiting }));
    } catch (error) { return sendError(reply, error); }
  });
}
