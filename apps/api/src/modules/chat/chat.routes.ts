import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { listChatChannels, markChannelRead } from "./chat.service.js";

// Aggregator only — sending/listing individual channel messages still goes through
// league-chat / game-chat / commissioner-chat directly. Unread state is per-user, so both
// routes require a real user session (bot-mode callers have no userId to track read state for).
export async function chatRoutes(app: FastifyInstance) {
  app.post("/v1/chat/channels/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Chat channel list requires a user session."));
      return reply.send(await listChatChannels(guildId, auth.discordId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/chat/channels/mark-read", async (request, reply) => {
    try {
      const body = z
        .object({
          guildId: z.string().min(1),
          channelType: z.enum(["league", "game", "commissioner"]),
          channelId: z.string().min(1),
          lastReadMessageId: z.string().uuid(),
        })
        .parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Marking a channel read requires a user session."));
      return reply.send(
        await markChannelRead({
          guildId: body.guildId,
          discordId: auth.discordId,
          channelType: body.channelType,
          channelId: body.channelId,
          lastReadMessageId: body.lastReadMessageId,
        }),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
