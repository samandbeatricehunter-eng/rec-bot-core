import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getRecordBook } from "./record-book.service.js";

export async function recordBookRoutes(app: FastifyInstance) {
  app.post("/v1/hub/record-book", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        scope: z.enum(["game", "season", "career"]),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getRecordBook(body.guildId, body.scope));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
