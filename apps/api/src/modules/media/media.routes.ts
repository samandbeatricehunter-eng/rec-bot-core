import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import {
  createHighlightDirectUpload,
  getHighlightUploadStatus,
  handleStreamWebhook,
  markHighlightUploadReceived,
} from "./media.service.js";

export async function mediaRoutes(app: FastifyInstance) {
  app.post("/v1/hub/highlights/direct-upload", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        gameId: z.string().uuid(),
        fileName: z.string().max(200).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight uploads require a user session.");
      return reply.send(await createHighlightDirectUpload({
        guildId: body.guildId,
        discordId: auth.discordId,
        gameId: body.gameId,
        fileName: body.fileName,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/hub/highlights/upload-received", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        highlightId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight uploads require a user session.");
      return reply.send(await markHighlightUploadReceived({
        guildId: body.guildId,
        discordId: auth.discordId,
        highlightId: body.highlightId,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/hub/highlights/status", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        highlightId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Highlight status requires a user session.");
      return reply.send(await getHighlightUploadStatus({
        guildId: body.guildId,
        discordId: auth.discordId,
        highlightId: body.highlightId,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/media/stream-webhook", async (request, reply) => {
    try {
      const withRaw = request as unknown as { rawBody?: unknown; body?: unknown };
      const rawBody = typeof withRaw.rawBody === "string"
        ? withRaw.rawBody
        : typeof withRaw.body === "string"
          ? withRaw.body
          : JSON.stringify(withRaw.body ?? {});
      const signatureHeader = request.headers["webhook-signature"];
      return reply.send(await handleStreamWebhook({
        rawBody,
        signatureHeader: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}