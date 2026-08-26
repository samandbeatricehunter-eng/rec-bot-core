import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bestEffort } from "../../lib/best-effort.js";
import { resolveUserSessionFromToken, assertGuildPermission } from "../../lib/user-auth.js";
import { subscribeSocket, unsubscribeSocket, dropSocket } from "./chat-realtime.js";
import { supabase } from "../../lib/supabase.js";

// Only remaining consumer is the Fantasy Draft Board's live-refresh transport (the chat
// messaging feature itself -- league/game/commissioner chat -- was removed; this in-process
// pub/sub + websocket layer was kept because Fantasy Draft depends on it independently of
// chat). fantasy_draft channels use the league id directly as the channel id -- the board
// refreshes via a one-shot refetch on event, so there's no per-message row to resolve.
const ChannelTypeSchema = z.literal("fantasy_draft");
const ClientMessageSchema = z.union([
  z.object({ type: z.literal("subscribe"), channelType: ChannelTypeSchema, channelId: z.string().min(1) }),
  z.object({ type: z.literal("unsubscribe"), channelType: ChannelTypeSchema, channelId: z.string().min(1) }),
]);

async function canSubscribeToChannel(session: { discordId: string }, channelId: string): Promise<boolean> {
  const league = await supabase.from("rec_leagues").select("id").eq("id", channelId).maybeSingle();
  if (!league.data?.id) return false;
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", session.discordId).maybeSingle();
  if (!account.data?.user_id) return false;
  const membership = await supabase
    .from("rec_league_memberships")
    .select("id")
    .eq("league_id", channelId)
    .eq("user_id", account.data.user_id)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(membership.data);
}

// One socket per browser tab. Auth travels as a query param (?token=&guildId=) because the
// WebSocket constructor can't set custom headers from a browser.
export async function chatRealtimeRoutes(app: FastifyInstance) {
  app.get("/v1/chat/socket", { websocket: true }, async (socket, request) => {
    const query = request.query as { token?: string; guildId?: string };
    const session = query.token ? await bestEffort("chat.resolve_session", () => resolveUserSessionFromToken(query.token!, query.guildId ?? null), { guildId: query.guildId }) ?? null : null;
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
      void (async () => {
        const allowed = await canSubscribeToChannel(session, result.data.channelId).catch(() => false);
        if (!allowed) return;
        if (result.data.type === "subscribe") subscribeSocket(socket, result.data.channelType, result.data.channelId);
        else unsubscribeSocket(socket, result.data.channelType, result.data.channelId);
      })();
    });

    socket.on("close", () => dropSocket(socket));
    socket.on("error", () => dropSocket(socket));
  });
}
