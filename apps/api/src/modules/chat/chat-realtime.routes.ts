import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bestEffort } from "../../lib/best-effort.js";
import { resolveUserSessionFromToken, assertGuildPermission } from "../../lib/user-auth.js";
import { subscribeSocket, unsubscribeSocket, dropSocket } from "./chat-realtime.js";
import { supabase } from "../../lib/supabase.js";

const ChannelTypeSchema = z.enum(["league", "game", "commissioner", "fantasy_draft"]);
const ClientMessageSchema = z.union([
  z.object({ type: z.literal("subscribe"), channelType: ChannelTypeSchema, channelId: z.string().min(1) }),
  z.object({ type: z.literal("unsubscribe"), channelType: ChannelTypeSchema, channelId: z.string().min(1) }),
]);

type RealtimeChannelType = "league" | "game" | "commissioner" | "fantasy_draft";

async function resolveChannelLeagueId(channelType: RealtimeChannelType, channelId: string): Promise<string | null> {
  if (channelType === "league" || channelType === "fantasy_draft") {
    // fantasy_draft channels use the league id directly as the channel id — the board
    // refreshes via a one-shot refetch on event, so there's no per-message row to resolve.
    const result = await supabase.from("rec_leagues").select("id").eq("id", channelId).maybeSingle();
    return result.data?.id ?? null;
  }
  if (channelType === "game") {
    const result = await supabase.from("rec_game_channels").select("league_id").eq("id", channelId).maybeSingle();
    return result.data?.league_id ?? null;
  }
  const server = await supabase.from("rec_discord_servers").select("id").eq("guild_id", channelId).maybeSingle();
  if (!server.data?.id) return null;
  const link = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", server.data.id)
    .eq("is_primary", true)
    .maybeSingle();
  return link.data?.league_id ?? null;
}

async function canSubscribeToChannel(
  session: { discordId: string },
  channelType: RealtimeChannelType,
  channelId: string,
): Promise<boolean> {
  const leagueId = await resolveChannelLeagueId(channelType, channelId);
  if (!leagueId) return false;
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", session.discordId).maybeSingle();
  if (!account.data?.user_id) return false;
  const membership = await supabase
    .from("rec_league_memberships")
    .select("role,status")
    .eq("league_id", leagueId)
    .eq("user_id", account.data.user_id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership.data) return false;
  // fantasy_draft is an open league channel (any member), like "league" — the board itself
  // gates commissioner-only actions, not the subscription.
  if (channelType !== "commissioner") return true;
  if (["commissioner", "co_commissioner"].includes(String(membership.data.role))) return true;
  const owner = await supabase.from("rec_leagues").select("owner_user_id").eq("id", leagueId).eq("owner_user_id", account.data.user_id).maybeSingle();
  return Boolean(owner.data);
}

// One socket per browser tab, reused across channel switches — the client sends
// subscribe/unsubscribe messages as chat-store.ts activates/deactivates channels rather than
// opening a new connection per channel. Auth travels as a query param (?token=&guildId=)
// because the WebSocket constructor can't set custom headers from a browser.
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
        const allowed = await canSubscribeToChannel(session, result.data.channelType, result.data.channelId).catch(() => false);
        if (!allowed) return;
        if (result.data.type === "subscribe") subscribeSocket(socket, result.data.channelType, result.data.channelId);
        else unsubscribeSocket(socket, result.data.channelType, result.data.channelId);
      })();
    });

    socket.on("close", () => dropSocket(socket));
    socket.on("error", () => dropSocket(socket));
  });
}
