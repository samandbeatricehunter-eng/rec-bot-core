import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { cancelCommissionerPoll, closeCommissionerPoll, createCommissionerPoll, listCommissionerPolls, voteOnCommissionerPoll } from "./commissioner-polls.service.js";

export async function pollsRoutes(app: FastifyInstance) {
  // Commissioner "Create Poll" on the Media page — site-first: the poll is fully votable from
  // the website with no Discord link required. If a voting-polls channel is configured, an
  // informational (non-interactive) embed mirrors it there, but the site vote is canonical.
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
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listCommissionerPolls({ ...body, discordId: auth.mode === "user" ? auth.discordId : undefined }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/polls/vote", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pollId: z.string().uuid(), optionId: z.number().int() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Voting is website-only.");
      return reply.send(await voteOnCommissionerPoll({ ...body, discordId: auth.discordId }));
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
