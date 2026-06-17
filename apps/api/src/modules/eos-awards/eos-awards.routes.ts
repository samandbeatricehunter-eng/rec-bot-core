import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getLeagueContext } from "../advance/advance-shared.js";
import { castEosVote, getEosAwardPolls, lockEosAwardPolls, resolveCanTShutUpTiebreaker } from "./eos-awards.service.js";

export async function eosAwardsRoutes(app: FastifyInstance) {
  app.post("/v1/eos-awards/vote", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await castEosVote(request.body as any));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/eos-awards/lock", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = request.body as { guildId: string };
      const context = await getLeagueContext(guildId);
      const league = context.rec_leagues;
      const leagueId = context.league_id;
      const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
      return reply.send(await lockEosAwardPolls(leagueId, seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/eos-awards/tiebreaker", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await resolveCanTShutUpTiebreaker(request.body as any));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/eos-awards/polls", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await getEosAwardPolls((request.body as any).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
