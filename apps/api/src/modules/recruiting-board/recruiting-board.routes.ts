import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { createRecruitingBoardTeamRequest, getRecruitingBoardGroupedTeams, getRecruitingBoardLeagueSettings, getRecruitingBoardOpenTeams } from "./recruiting-board.service.js";

const RequestSchema = z.object({
  leagueId: z.string().uuid(),
  discordId: z.string().min(1),
  teamId: z.string().uuid(),
});

export async function recruitingBoardRoutes(app: FastifyInstance) {
  app.get("/v1/recruiting-board/leagues/:leagueId/open-teams", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { leagueId } = request.params as { leagueId: string };
      return reply.send(await getRecruitingBoardOpenTeams(leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/recruiting-board/leagues/:leagueId/grouped-teams", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { leagueId } = request.params as { leagueId: string };
      return reply.send(await getRecruitingBoardGroupedTeams(leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/recruiting-board/leagues/:leagueId/settings", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { leagueId } = request.params as { leagueId: string };
      return reply.send(await getRecruitingBoardLeagueSettings(leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/recruiting-board/request", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createRecruitingBoardTeamRequest(RequestSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
