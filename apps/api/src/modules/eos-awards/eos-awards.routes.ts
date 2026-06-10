import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
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
      const { data: server } = await import("../../lib/supabase.js").then(({ supabase }) =>
        supabase.from("rec_discord_servers").select("league_id").eq("guild_id", guildId).maybeSingle()
      );
      const { data: league } = await import("../../lib/supabase.js").then(({ supabase }) =>
        supabase.from("rec_leagues").select("season_number,display_season_number").eq("id", (server as any)?.league_id).maybeSingle()
      );
      const leagueId = (server as any)?.league_id;
      const seasonNumber = (league as any)?.season_number ?? (league as any)?.display_season_number ?? 1;
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
