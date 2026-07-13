import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { listCommissionerNotifications, listCompletedCommissionerTransactions, listUnattendedCommissionerNotifications, markCommissionerNotificationsDmSent } from "./notifications.service.js";

const ListSchema = z.object({
  guildId: z.string().min(1),
  // Set by the bot's polling loop (1e) to fetch only items created since its last check;
  // omitted by the web dashboard, which always wants the full pending list.
  sinceIso: z.string().datetime().optional().nullable(),
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
}
