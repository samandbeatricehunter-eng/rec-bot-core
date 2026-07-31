import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { deleteGameChatMessage, editGameChatMessage, getGameChatMessages, ingestDiscordGameChatMessage, listGameChatChannels, sendGameChatMessage } from "./game-chat.service.js";

// Whole-league visibility: every route below is permission: "member" (no coach/commissioner
// restriction) except the bot-only Discord ingest endpoint.
export async function gameChatRoutes(app: FastifyInstance) {
  app.post("/v1/game-chat/channels/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listGameChatChannels(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-chat/messages/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameChannelId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getGameChatMessages(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-chat/messages/post", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameChannelId: z.string().uuid(), body: z.string().min(1).max(2000), replyToMessageId: z.string().uuid().optional().nullable() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Game chat requires a user session."));
      return reply.send(await sendGameChatMessage({ guildId: body.guildId, discordId: auth.discordId, gameChannelId: body.gameChannelId, body: body.body, replyToMessageId: body.replyToMessageId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-chat/messages/edit", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), messageId: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Editing requires a user session."));
      return reply.send(await editGameChatMessage({ guildId: body.guildId, discordId: auth.discordId, messageId: body.messageId, body: body.body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-chat/messages/delete", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), messageId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Deleting requires a user session."));
      return reply.send(await deleteGameChatMessage({ guildId: body.guildId, discordId: auth.discordId, messageId: body.messageId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-chat/messages/ingest", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z
        .object({
          discordChannelId: z.string().min(1),
          discordUserId: z.string().min(1),
          discordMessageId: z.string().min(1),
          content: z.string().min(1).max(4000),
        })
        .parse(request.body);
      return reply.send(await ingestDiscordGameChatMessage(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
