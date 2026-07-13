import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import {
  getLeagueUserIdentities,
  getLeagueSeasonXfBadges,
  getUserBaselineByDiscordId,
  getUserMenuProfileByDiscordId,
  getWalletByDiscordId,
  refreshActiveLeagueBadgeBaselines,
  transferSavings,
  getUserSnapshot,
  getUserScheduleByDiscordId,
} from "./user.service.js";
import { supabase } from "../../lib/supabase.js";
import { findCurrentLeagueContext } from "../league-context/league-context.service.js";
export async function userRoutes(app: FastifyInstance) {
  app.post("/v1/users/me/wallet/transfer", async (request, reply) => {
    try {
      const input = z.object({ guildId: z.string().min(1), amount: z.number().positive(), direction: z.enum(["to_savings", "from_savings"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => input.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("The self-service transfer route requires a user session.");
      return reply.send(await transferSavings(auth.discordId, input.amount, input.direction));
    } catch (error) { return sendError(reply, error); }
  });
  app.get("/v1/users/:discordId/baseline", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; return reply.send(await getUserBaselineByDiscordId(discordId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/users/:discordId/wallet", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = (request.query ?? {}) as { guildId?: string }; return reply.send(await getWalletByDiscordId(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/users/:discordId/menu-profile", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = request.query as { guildId: string }; return reply.send(await getUserMenuProfileByDiscordId(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/users/:discordId/schedule", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = request.query as { guildId: string }; return reply.send(await getUserScheduleByDiscordId(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/guilds/:guildId/identities", async (request, reply) => { try { await requireBotOrUserSession(request, { resolveGuildId: (r: any) => (r.params as { guildId: string }).guildId, permission: "member" }); const { guildId } = request.params as { guildId: string }; return reply.send(await getLeagueUserIdentities(guildId)); } catch (error) { return sendError(reply, error); }});
  app.get("/v1/guilds/:guildId/badges/xf-season", async (request, reply) => { try { requireInternalApiKey(request); const { guildId } = request.params as { guildId: string }; const { seasonNumber } = request.query as { seasonNumber?: string }; return reply.send(await getLeagueSeasonXfBadges(guildId, seasonNumber ? Number(seasonNumber) : null)); } catch (error) { return sendError(reply, error); }});
  app.post("/v1/guilds/:guildId/badges/refresh-baselines", async (request, reply) => { try { requireInternalApiKey(request); const { guildId } = request.params as { guildId: string }; return reply.send(await refreshActiveLeagueBadgeBaselines(guildId)); } catch (error) { return sendError(reply, error); }});
  // Transfer between wallet and savings. direction: "to_savings" | "from_savings", amount: number (positive).
  app.post("/v1/users/:discordId/wallet/transfer", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { amount, direction } = request.body as { amount: number; direction: "to_savings" | "from_savings" }; return reply.send(await transferSavings(discordId, amount, direction)); } catch (error) { return sendError(reply, error); }});
  // Full user snapshot for the Rosters > User Snapshots paginated viewer.
  app.get("/v1/users/:discordId/snapshot", async (request, reply) => { try { requireInternalApiKey(request); const { discordId } = request.params as { discordId: string }; const { guildId } = request.query as { guildId: string }; return reply.send(await getUserSnapshot(discordId, guildId)); } catch (error) { return sendError(reply, error); }});
  // List all linked coaches in a guild's league — used to populate the User Snapshots user selector.
  app.get("/v1/guilds/:guildId/coaches", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.params as { guildId: string };
      const context = await findCurrentLeagueContext(guildId);
      if (!context?.leagueId) return reply.send({ coaches: [] });
      const { data } = await supabase
        .from("rec_team_assignments")
        .select("user_id,team_id,user:rec_users(display_name),team:rec_teams(name,abbreviation)")
        .eq("league_id", context.leagueId)
        .eq("assignment_status", "active")
        .is("ended_at", null);
      const userIds = [...new Set((data ?? []).map((row: any) => row.user_id).filter(Boolean))];
      const { data: discordAccounts } = userIds.length
        ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds)
        : { data: [] };
      const discordByUser = new Map<string, any>((discordAccounts ?? []).map((account: any) => [account.user_id, account]));
      const coaches = (data ?? []).map((row: any) => {
        const discordAcc = discordByUser.get(row.user_id) ?? null;
        return {
          userId: row.user_id,
          teamId: row.team_id,
          displayName: row.user?.display_name ?? discordAcc?.global_name ?? discordAcc?.username ?? "Unknown",
          discordId: discordAcc?.discord_id ?? null,
          teamName: row.team?.name ?? null,
          teamAbbreviation: row.team?.abbreviation ?? null
        };
      });
      return reply.send({ coaches });
    } catch (error) { return sendError(reply, error); }
  });
}
