import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { attachToMessage, listChatAttachments, listChatChannels, listChatReactions, markChannelRead, SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES, toggleChatReaction, uploadChatAttachmentImage } from "./chat.service.js";

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

  app.post("/v1/chat/reactions/list", async (request, reply) => {
    try {
      const body = z
        .object({ guildId: z.string().min(1), channelType: z.enum(["league", "game", "commissioner"]), messageIds: z.array(z.string().uuid()).max(300) })
        .parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Reaction list requires a user session."));
      return reply.send(await listChatReactions({ channelType: body.channelType, messageIds: body.messageIds, discordId: auth.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/chat/reactions/toggle", async (request, reply) => {
    try {
      const body = z
        .object({ guildId: z.string().min(1), channelType: z.enum(["league", "game", "commissioner"]), messageId: z.string().uuid(), emojiKey: z.string().min(1).max(32) })
        .parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") return sendError(reply, new ApiError(400, "Reacting requires a user session."));
      return reply.send(await toggleChatReaction({ discordId: auth.discordId, channelType: body.channelType, messageId: body.messageId, emojiKey: body.emojiKey }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Two-step attach flow: upload the file (no message exists yet), send the message through
  // the existing league-chat/game-chat/commissioner-chat endpoints unchanged, then link the
  // upload to the new message id via /attach. Keeps the three send functions untouched.
  app.post("/v1/chat/attachments/upload", async (request, reply) => {
    try {
      const guildId = (request.query as { guildId?: string })?.guildId;
      if (!guildId) throw new ApiError(400, "Missing guildId.");
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      const file = await request.file();
      if (!file) throw new ApiError(400, "Missing file.");
      if (!SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES.has(file.mimetype)) throw new ApiError(400, "Unsupported file type.");
      const buffer = await file.toBuffer();
      const { storageKey, url } = await uploadChatAttachmentImage(buffer, file.mimetype);
      return reply.send({ storageKey, url, mimeType: file.mimetype, filename: file.filename, sizeBytes: buffer.byteLength });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/chat/attachments/attach", async (request, reply) => {
    try {
      const body = z
        .object({
          guildId: z.string().min(1),
          channelType: z.enum(["league", "game", "commissioner"]),
          messageId: z.string().uuid(),
          storageKey: z.string().min(1),
          url: z.string().url(),
          mimeType: z.string().min(1),
          filename: z.string().optional().nullable(),
          sizeBytes: z.number().int().optional().nullable(),
        })
        .parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await attachToMessage(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/chat/attachments/list", async (request, reply) => {
    try {
      const body = z
        .object({ guildId: z.string().min(1), channelType: z.enum(["league", "game", "commissioner"]), messageIds: z.array(z.string().uuid()).max(300) })
        .parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listChatAttachments(body.channelType, body.messageIds));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
