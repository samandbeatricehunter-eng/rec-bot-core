import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { cancelCommissionerPoll, closeCommissionerPoll, createCommissionerPoll, listCommissionerPolls } from "./commissioner-polls.service.js";

export async function pollsRoutes(app: FastifyInstance) {
  // Commissioner "Create Poll" on the Media page — posts a native single-select Discord poll
  // to the league's voting-polls channel. Discord's own platform enforces one vote per member.
  app.post("/v1/polls/create", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        question: z.string().min(1).max(300),
        options: z.array(z.string().min(1)).min(2).max(10),
        durationHours: z.number().int().min(1).max(720).default(24),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") body.discordId = auth.discordId;
      return reply.send(await createCommissionerPoll(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/polls/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listCommissionerPolls(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/polls/close", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await closeCommissionerPoll(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/polls/cancel", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await cancelCommissionerPoll(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
