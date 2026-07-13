import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { closeChatTopic, createChatTopic, listChatMessages, listChatTopics, postChatMessage, voteOnChatTopic } from "./commissioner-chat.service.js";

// Everything here is co_commissioner-gated (not full-commissioner-only) — this is meant to
// be a shared space for commissioners AND co-commissioners, matching who could already see
// the Commissioner's Office Discord channel this is meant to eventually replace.
export async function commissionerChatRoutes(app: FastifyInstance) {
  app.post("/v1/commissioner-chat/messages/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), sinceIso: z.string().datetime().optional().nullable() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listChatMessages(body.guildId, body.sinceIso));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/commissioner-chat/messages/post", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), body: z.string().min(1).max(2000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Commissioner chat requires a user session."));
      return reply.send(await postChatMessage({ guildId: body.guildId, discordId: auth.discordId, body: body.body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/commissioner-chat/topics/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await listChatTopics(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/commissioner-chat/topics/create", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional().nullable(),
        options: z.array(z.string().min(1).max(100)).min(2).max(10),
        closesAt: z.string().datetime().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Commissioner chat requires a user session."));
      return reply.send(await createChatTopic({ ...body, discordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/commissioner-chat/topics/vote", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), topicId: z.string().uuid(), optionIndex: z.number().int().min(0) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Commissioner chat requires a user session."));
      return reply.send(await voteOnChatTopic({ ...body, discordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/commissioner-chat/topics/close", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), topicId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await closeChatTopic(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
