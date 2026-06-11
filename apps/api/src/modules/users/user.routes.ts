import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getUserBaselineByDiscordId, getUserMenuProfileByDiscordId, getWalletByDiscordId, transferSavings, getUserSnapshot } from "./user.service.js";
import { supabase } from "../../lib/supabase.js";
export async function userRoutes(app: FastifyInstance) {
  app.get("/v1/users/:discordId/baseline", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; return reply.send(await getUserBaselineByDiscordId(discordId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/users/:discordId/wallet", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = (request.query ?? {}) as { guildId?: string }; return reply.send(await getWalletByDiscordId(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/users/:discordId/menu-profile", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = request.query as { guildId: string }; return reply.send(await getUserMenuProfileByDiscordId(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  // Transfer between wallet and savings. direction: "to_savings" | "from_savings", amount: number (positive).
  app.post("/v1/users/:discordId/wallet/transfer", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { amount, direction } = request.body as { amount: number; direction: "to_savings" | "from_savings" }; return reply.send(await transferSavings(discordId, amount, direction)); } catch (error) { return sendError(reply, error); }});
  // Full user snapshot for the Rosters > User Snapshots paginated viewer.
  app.get("/v1/users/:discordId/snapshot", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = request.query as { guildId: string }; return reply.send(await getUserSnapshot(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  // List all linked coaches in a guild's league — used to populate the User Snapshots user selector.
  app.get("/v1/guilds/:guildId/coaches", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.params as { guildId: string };
      const server = await supabase.from("rec_discord_servers").select("id").eq("guild_id", guildId).maybeSingle();
      if (!server.data) return reply.send({ coaches: [] });
      const link = await supabase.from("rec_server_league_links").select("league_id").eq("server_id", server.data.id).eq("is_primary", true).maybeSingle();
      if (!link.data?.league_id) return reply.send({ coaches: [] });
      const { data } = await supabase
        .from("rec_team_assignments")
        .select("user_id,team_id,rec_users(display_name),rec_discord_accounts(discord_id,username,global_name),rec_teams(name,abbreviation)")
        .eq("league_id", link.data.league_id)
        .eq("assignment_status", "active")
        .is("ended_at", null);
      const coaches = (data ?? []).map((row: any) => ({
        userId: row.user_id,
        teamId: row.team_id,
        displayName: row.rec_users?.display_name ?? row.rec_discord_accounts?.global_name ?? row.rec_discord_accounts?.username ?? "Unknown",
        discordId: row.rec_discord_accounts?.discord_id ?? null,
        teamName: row.rec_teams?.name ?? null,
        teamAbbreviation: row.rec_teams?.abbreviation ?? null
      }));
      return reply.send({ coaches });
    } catch (error) { return sendError(reply, error); }
  });
}
