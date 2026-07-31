import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveUserSessionFromToken, assertGuildPermission } from "../../lib/user-auth.js";
import { subscribeSocket, unsubscribeSocket, dropSocket } from "./chat-realtime.js";

const ChannelTypeSchema = z.enum(["league", "game", "commissioner"]);
const ClientMessageSchema = z.union([
  z.object({ type: z.literal("subscribe"), channelType: ChannelTypeSchema, channelId: z.string().min(1) }),
  z.object({ type: z.literal("unsubscribe"), channelType: ChannelTypeSchema, channelId: z.string().min(1) }),
]);

// One socket per browser tab, reused across channel switches — the client sends
// subscribe/unsubscribe messages as chat-store.ts activates/deactivates channels rather than
// opening a new connection per channel. Auth travels as a query param (?token=&guildId=)
// because the WebSocket constructor can't set custom headers from a browser.
export async function chatRealtimeRoutes(app: FastifyInstance) {
  app.get("/v1/chat/socket", { websocket: true }, async (socket, request) => {
    const query = request.query as { token?: string; guildId?: string };
    const session = query.token ? await resolveUserSessionFromToken(query.token, query.guildId ?? null).catch(() => null) : null;
    if (!session) {
      socket.close(4401, "Unauthorized");
      return;
    }
    try {
      await assertGuildPermission(session.guildId, session.discordId, "member");
    } catch {
      socket.close(4403, "Forbidden");
      return;
    }

    socket.on("message", (raw: Buffer) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); } catch { return; }
      const result = ClientMessageSchema.safeParse(parsed);
      if (!result.success) return;
      if (result.data.type === "subscribe") subscribeSocket(socket, result.data.channelType, result.data.channelId);
      else unsubscribeSocket(socket, result.data.channelType, result.data.channelId);
    });

    socket.on("close", () => dropSocket(socket));
    socket.on("error", () => dropSocket(socket));
  });
}
