import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { bestEffort } from "../../lib/best-effort.js";
import { verifySupabaseAccessToken } from "../../lib/supabase-jwt.js";
import { resolveRecUserIdByAuthUserId, resolveRecUserIdByDiscordId } from "../subscriptions/entitlements.service.js";
import { isStreamPlatform } from "./streaming-labels.js";
import { verifyTwitchEventsubSignature } from "./twitch-client.js";
import { dropStreamingSocket, subscribeStreamingSocket } from "./streaming-realtime.js";
import {
  completeStreamingOAuth,
  confirmPrompt,
  confirmGameFromSite,
  declinePrompt,
  getLivePromptForUser,
  handleTwitchEventsubPayload,
  linkTiktokUsername,
  listH2hMatchupsForUser,
  listStreamingAccounts,
  selectPromptGame,
  startStreamingOAuth,
  unlinkStreamingAccount,
} from "./streaming.service.js";

const PlatformSchema = z.enum(["twitch", "youtube", "tiktok"]);

async function requireSiteRecUser(request: Parameters<typeof requireSiteUserSession>[0]) {
  const session = await requireSiteUserSession(request);
  const recUserId = await resolveRecUserIdByAuthUserId(session.authUserId);
  if (!recUserId) throw new ApiError(404, "Finish setting up your REC profile first.");
  return { ...session, recUserId };
}

async function recUserFromDiscordId(discordId: string): Promise<string> {
  const recUserId = await resolveRecUserIdByDiscordId(discordId);
  if (!recUserId) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return recUserId;
}

export async function streamingRoutes(app: FastifyInstance) {
  app.post("/v1/streaming/accounts", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      return reply.send(await listStreamingAccounts(auth.recUserId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/oauth/start", async (request, reply) => {
    try {
      const session = await requireSiteUserSession(request);
      const body = z.object({ platform: PlatformSchema }).parse(request.body ?? {});
      return reply.send(startStreamingOAuth({ authUserId: session.authUserId, platform: body.platform }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/streaming/oauth/:platform/callback", async (request, reply) => {
    try {
      const params = z.object({ platform: z.string() }).parse(request.params);
      if (!isStreamPlatform(params.platform)) throw new ApiError(400, "Unknown streaming platform.");
      const query = z.object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().optional(),
      }).parse(request.query ?? {});
      if (query.error || !query.code || !query.state) {
        const { siteAccountRedirect } = await import("./streaming-config.js");
        return reply.redirect(siteAccountRedirect({ streaming: "error", platform: params.platform }));
      }
      return reply.redirect(await completeStreamingOAuth({ platform: params.platform, code: query.code, state: query.state }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/tiktok/username", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      const body = z.object({ username: z.string().min(1).max(32) }).parse(request.body ?? {});
      return reply.send(await linkTiktokUsername(auth.recUserId, body.username));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/accounts/unlink", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      const body = z.object({ platform: PlatformSchema }).parse(request.body ?? {});
      return reply.send(await unlinkStreamingAccount(auth.recUserId, body.platform));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/h2h-matchups", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      return reply.send({ matchups: await listH2hMatchupsForUser(auth.recUserId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/live-prompt", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      return reply.send(await getLivePromptForUser(auth.recUserId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/live-prompt/respond", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      const body = z.object({
        promptId: z.string().uuid(),
        action: z.enum(["confirm", "decline"]),
        gameId: z.string().uuid().optional().nullable(),
      }).parse(request.body ?? {});
      if (body.action === "decline") return reply.send(await declinePrompt({ userId: auth.recUserId, promptId: body.promptId }));
      return reply.send(await confirmPrompt({
        userId: auth.recUserId,
        promptId: body.promptId,
        gameId: body.gameId,
        source: "site_modal",
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/confirm-game", async (request, reply) => {
    try {
      const auth = await requireSiteRecUser(request);
      const body = z.object({
        gameId: z.string().uuid(),
        source: z.enum(["site_modal", "site_share"]).optional(),
      }).parse(request.body ?? {});
      return reply.send(await confirmGameFromSite({
        userId: auth.recUserId,
        gameId: body.gameId,
        source: body.source ?? "site_modal",
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/discord/select", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        discordId: z.string().min(1),
        promptId: z.string().uuid(),
        gameId: z.string().uuid(),
      }).parse(request.body ?? {});
      const userId = await recUserFromDiscordId(body.discordId);
      return reply.send(await selectPromptGame({ userId, promptId: body.promptId, gameId: body.gameId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/discord/confirm", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        discordId: z.string().min(1),
        promptId: z.string().uuid(),
        gameId: z.string().uuid().optional().nullable(),
      }).parse(request.body ?? {});
      const userId = await recUserFromDiscordId(body.discordId);
      return reply.send(await confirmPrompt({
        userId,
        promptId: body.promptId,
        gameId: body.gameId,
        source: "discord_dm",
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/discord/decline", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        discordId: z.string().min(1),
        promptId: z.string().uuid(),
      }).parse(request.body ?? {});
      const userId = await recUserFromDiscordId(body.discordId);
      return reply.send(await declinePrompt({ userId, promptId: body.promptId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streaming/twitch/eventsub", async (request, reply) => {
    try {
      const rawBody = (request as { rawBody?: string }).rawBody ?? "";
      const headers = {
        messageId: String(request.headers["twitch-eventsub-message-id"] ?? ""),
        timestamp: String(request.headers["twitch-eventsub-message-timestamp"] ?? ""),
        signature: String(request.headers["twitch-eventsub-message-signature"] ?? ""),
      };
      if (!verifyTwitchEventsubSignature(rawBody, headers)) {
        throw new ApiError(403, "Invalid Twitch EventSub signature.");
      }
      const messageType = String(request.headers["twitch-eventsub-message-type"] ?? "");
      const body = (request.body ?? {}) as { challenge?: string; subscription?: { type?: string }; event?: unknown };
      if (messageType === "webhook_callback_verification") {
        return reply.type("text/plain").send(String(body.challenge ?? ""));
      }
      if (messageType === "revocation") return reply.send({ ok: true });
      return reply.send(await handleTwitchEventsubPayload(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/streaming/socket", { websocket: true }, async (socket, request) => {
    const query = request.query as { token?: string };
    const verified = query.token
      ? await bestEffort("streaming.resolve_session", () => verifySupabaseAccessToken(query.token!), {})
      : null;
    const recUserId = verified?.userId ? await resolveRecUserIdByAuthUserId(verified.userId) : null;
    if (!recUserId) {
      socket.close(4401, "Unauthorized");
      return;
    }
    subscribeStreamingSocket(socket, recUserId);
    socket.on("close", () => dropStreamingSocket(socket));
    socket.on("error", () => dropStreamingSocket(socket));
  });
}
