import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { deleteLeagueChatMessage, editLeagueChatMessage, heartbeat, ingestDiscordLeagueChatMessage, listLeagueChatMessages, listLeagueMembersForChat, postLeagueChatMessage } from "./league-chat.service.js";

// League-wide chat — open to every league member (permission: "member"), unlike the
// co_commissioner-gated commissioner chat this mirrors in shape.
export async function leagueChatRoutes(app: FastifyInstance) {
  app.post("/v1/league-chat/messages/ingest", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        discordChannelId: z.string().min(1),
        discordUserId: z.string().min(1),
        discordMessageId: z.string().min(1),
        content: z.string().trim().min(1).max(4000),
      }).parse(request.body);
      return reply.send(await ingestDiscordLeagueChatMessage(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/v1/league-chat/messages/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), sinceIso: z.string().datetime().optional().nullable() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listLeagueChatMessages(body.guildId, body.sinceIso));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-chat/messages/post", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), body: z.string().min(1).max(2000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "League chat requires a user session."));
      return reply.send(await postLeagueChatMessage({ guildId: body.guildId, discordId: auth.discordId, body: body.body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-chat/members/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listLeagueMembersForChat(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-chat/messages/edit", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), messageId: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Editing requires a user session."));
      return reply.send(await editLeagueChatMessage({ guildId: body.guildId, discordId: auth.discordId, messageId: body.messageId, body: body.body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-chat/messages/delete", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), messageId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Deleting requires a user session."));
      return reply.send(await deleteLeagueChatMessage({ guildId: body.guildId, discordId: auth.discordId, messageId: body.messageId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/league-chat/heartbeat", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode !== "user") return reply.send({ ok: true });
      return reply.send(await heartbeat({ guildId, discordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
