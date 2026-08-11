import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import {
  getDemoLeagueHistory,
  getDemoFantasyDraftPool,
  getDemoLeagueStats,
  getDemoLeagueTeamStats,
  getDemoNewsFeed,
  getDemoStandings,
  getDemoTeamMatchup,
  getDemoTeamRoster,
  listDemoLeagues,
  listDemoTeams,
} from "./demo-league.service.js";

const demoPhase = z.enum(["live", "week1", "playoffs", "championship", "draft"]).default("live");

// Intentionally unauthenticated, read-only — the public "try it before you sign up" preview.
// No route here accepts a mutation; every handler is a plain select scoped to the two
// hardcoded demo leagues (see DEMO_LEAGUE_GUILDS in the service).
export async function demoLeagueRoutes(app: FastifyInstance) {
  app.post("/v1/demo-league/leagues", async (_request, reply) => {
    try { return reply.send(await listDemoLeagues()); } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/teams", async (request, reply) => {
    try {
      const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(request.body);
      return reply.send(await listDemoTeams(leagueId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/news", async (request, reply) => {
    try {
      const { leagueId, phase } = z.object({ leagueId: z.string().uuid(), phase: demoPhase }).parse(request.body);
      return reply.send(await getDemoNewsFeed(leagueId, phase));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/matchup", async (request, reply) => {
    try {
      const { leagueId, teamId, phase } = z.object({ leagueId: z.string().uuid(), teamId: z.string().uuid(), phase: demoPhase }).parse(request.body);
      return reply.send(await getDemoTeamMatchup(leagueId, teamId, phase));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/roster", async (request, reply) => {
    try {
      const { leagueId, teamId } = z.object({ leagueId: z.string().uuid(), teamId: z.string().uuid() }).parse(request.body);
      return reply.send(await getDemoTeamRoster(leagueId, teamId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/fantasy-draft-pool", async (request, reply) => {
    try {
      const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(request.body);
      return reply.send(await getDemoFantasyDraftPool(leagueId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/standings", async (request, reply) => {
    try {
      const { leagueId, phase } = z.object({ leagueId: z.string().uuid(), phase: demoPhase }).parse(request.body);
      return reply.send(await getDemoStandings(leagueId, phase));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/stats", async (request, reply) => {
    try {
      const { leagueId, teamId, position } = z.object({
        leagueId: z.string().uuid(), teamId: z.string().uuid().nullable().optional(), position: z.string().max(20).nullable().optional(),
      }).parse(request.body);
      return reply.send(await getDemoLeagueStats(leagueId, { teamId, position }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/team-stats", async (request, reply) => {
    try {
      const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(request.body);
      return reply.send(await getDemoLeagueTeamStats(leagueId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/demo-league/history", async (request, reply) => {
    try {
      const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(request.body);
      return reply.send(await getDemoLeagueHistory(leagueId));
    } catch (error) { return sendError(reply, error); }
  });
}
