import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  EA_ADVANCE_ACTIONS,
  EA_DEFAULT_ADVANCE_ACTION,
  eaAddAdmin,
  eaBootUser,
  eaClearCapPenalties,
  eaForceAwayWin,
  eaForceHomeWin,
  eaForceNoWin,
  eaRemoveAdmin,
  eaSubmitCareerResponse,
  eaToggleAutoPilot,
  eaTransferAdmin,
  listForceableMatches,
} from "./ea-admin-actions.service.js";

// Every action here is a live write into a commissioner's Madden franchise via EA's Blaze API
// -- co-commissioner or above only, same gate as the rest of League Mgmt's commish tools.
async function requireLeagueCoCommissioner(request: FastifyRequest, guildId: string, leagueId: string) {
  const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
  if (auth.mode === "bot") throw new ApiError(403, "Browser session required.");
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== leagueId) throw new ApiError(403, "League does not belong to this server context.");
  return auth;
}

const baseBody = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() });
const teamBody = baseBody.extend({ team_id: z.string().uuid() });
const gameBody = baseBody.extend({ game_id: z.string().uuid() });

export async function eaAdminActionRoutes(app: FastifyInstance) {
  app.post("/v1/madden/ea/admin/forceable-matches", async (request, reply) => {
    try {
      const body = baseBody.parse(request.body);
      await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ matches: await listForceableMatches(body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/advance", async (request, reply) => {
    try {
      const body = baseBody.extend({ action: z.enum(EA_ADVANCE_ACTIONS).default(EA_DEFAULT_ADVANCE_ACTION) }).parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaSubmitCareerResponse(body.league_id, { source: "tool", actingDiscordId: auth.discordId }, body.action) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/clear-cap-penalties", async (request, reply) => {
    try {
      const body = teamBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaClearCapPenalties(body.league_id, body.team_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/boot-user", async (request, reply) => {
    try {
      const body = teamBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaBootUser(body.league_id, body.team_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/add-admin", async (request, reply) => {
    try {
      const body = teamBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaAddAdmin(body.league_id, body.team_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/remove-admin", async (request, reply) => {
    try {
      const body = teamBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaRemoveAdmin(body.league_id, body.team_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/transfer-admin", async (request, reply) => {
    try {
      const body = teamBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaTransferAdmin(body.league_id, body.team_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/force-home-win", async (request, reply) => {
    try {
      const body = gameBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaForceHomeWin(body.league_id, body.game_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/force-away-win", async (request, reply) => {
    try {
      const body = gameBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaForceAwayWin(body.league_id, body.game_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/clear-forced-result", async (request, reply) => {
    try {
      const body = gameBody.parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaForceNoWin(body.league_id, body.game_id, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/madden/ea/admin/toggle-autopilot", async (request, reply) => {
    try {
      const body = teamBody.extend({ weeks: z.number().int().min(1).max(17).default(1) }).parse(request.body);
      const auth = await requireLeagueCoCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ result: await eaToggleAutoPilot(body.league_id, body.team_id, body.weeks, { source: "tool", actingDiscordId: auth.discordId }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
