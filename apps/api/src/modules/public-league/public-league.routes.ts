import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { getPublicLeagueSnapshot, resolveLeagueGuildIdBySlug } from "./public-league.service.js";
import { getLeagueHistory } from "../league-history/league-history.service.js";

// Intentionally unauthenticated — this is the data source for the public /viewleague page,
// which anyone with the link (no REC account, no Discord login) can view.
export async function publicLeagueRoutes(app: FastifyInstance) {
  app.post("/v1/public-league/snapshot", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await getPublicLeagueSnapshot(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/public-league/snapshot-by-slug", async (request, reply) => {
    try {
      const { slug } = z.object({ slug: z.string().min(1) }).parse(request.body);
      const guildId = await resolveLeagueGuildIdBySlug(slug);
      return reply.send(await getPublicLeagueSnapshot(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/public-league/history", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await getLeagueHistory(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/public-league/history-by-slug", async (request, reply) => {
    try {
      const { slug } = z.object({ slug: z.string().min(1) }).parse(request.body);
      const guildId = await resolveLeagueGuildIdBySlug(slug);
      return reply.send(await getLeagueHistory(guildId));
    } catch (error) { return sendError(reply, error); }
  });
}
