import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber, resolveSeasonId } from "../league-context/season.service.js";
import { getLatestNflPlayoffBracketSnapshot, getNflPlayoffPicture } from "./nfl-bracket.service.js";
import { syncMaddenStandingsAndBracket } from "./nfl-standings.service.js";

export async function standingsRoutes(app: FastifyInstance) {
  app.post("/v1/standings/nfl-playoff-picture", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "member" });
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      const context = await getCurrentLeagueContext(input.guildId);
      if (!String(context.rec_leagues.game ?? "").startsWith("madden")) {
        throw new ApiError(400, "The NFL playoff bracket is available for Madden leagues only.");
      }
      const seasonNumber = resolveSeasonNumber(context, input.seasonNumber);
      return reply.send(await getNflPlayoffPicture(context.leagueId, seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner repair action: re-runs the standings/seed recompute and re-syncs every bracket
  // round in place, without waiting for the next Advance. Needed the moment a standings import
  // corrects a seed (or any other standings input changes) while the league's already sitting
  // mid-postseason -- syncMaddenStandingsAndBracket otherwise only ever runs from the Advance flow.
  app.post("/v1/standings/nfl-resync-bracket", async (request, reply) => {
    try {
      const input = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => input.guildId, permission: "co_commissioner" });
      const context = await getCurrentLeagueContext(input.guildId);
      if (!String(context.rec_leagues.game ?? "").startsWith("madden")) {
        throw new ApiError(400, "The NFL playoff bracket is available for Madden leagues only.");
      }
      const seasonNumber = Number(context.rec_leagues.season_number ?? 1);
      const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
      await syncMaddenStandingsAndBracket({
        leagueId: context.leagueId,
        seasonNumber,
        seasonId,
        seasonStage: String(context.rec_leagues.season_stage ?? ""),
      });
      return reply.send(await getNflPlayoffPicture(context.leagueId, seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/standings/nfl-playoff-bracket-snapshot", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "member" });
      const input = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const context = await getCurrentLeagueContext(input.guildId);
      if (!String(context.rec_leagues.game ?? "").startsWith("madden")) {
        throw new ApiError(400, "The NFL playoff bracket is available for Madden leagues only.");
      }
      return reply.send(await getLatestNflPlayoffBracketSnapshot(context.leagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
