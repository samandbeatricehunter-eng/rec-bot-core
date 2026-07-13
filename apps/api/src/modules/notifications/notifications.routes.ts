import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { listCommissionerNotifications } from "./notifications.service.js";

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
}
