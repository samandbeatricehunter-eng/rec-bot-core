import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import {
  getCommissionerPendingSummaryForLeague,
  listCommissionerNotifications,
  listCompletedCommissionerTransactions,
  listUnattendedCommissionerNotifications,
  markCommissionerInboxItemHandled,
  markCommissionerLeagueViewed,
  markCommissionerNotificationsDmSent,
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
}
