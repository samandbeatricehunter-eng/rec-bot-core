import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TOURNAMENT_BRACKET_TYPES, TOURNAMENT_PAYOUT_SCOPES } from "@rec/shared";
import { sendError } from "../../lib/errors.js";
import { isSiteAdminEmail, requireSiteAdmin } from "../../lib/site-admin.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { requireLinkedRecUser } from "../site-leagues/site-leagues.service.js";
import {
  cancelTournament,
  createTournament,
  getTournamentDetail,
  joinTournament,
  leaveTournament,
  listTournaments,
  lockTournamentBracket,
  reportTournamentWinner,
} from "./tournaments.service.js";

const gameSchema = z.enum(["madden_26", "madden_27", "cfb_27"]);
const payoutSchema = z.enum(["winner", "final_two", "final_four"]);

async function identity(request: Parameters<typeof requireSiteUserSession>[0]) {
  const session = await requireSiteUserSession(request);
  const user = await requireLinkedRecUser(session.authUserId);
  return { session, recUserId: user.recUserId, isAdmin: isSiteAdminEmail(session.email) };
}

export async function tournamentRoutes(app: FastifyInstance) {
  app.post("/v1/tournaments/meta", async (_request, reply) => {
    return reply.send({
      bracketTypes: TOURNAMENT_BRACKET_TYPES,
      payoutScopes: TOURNAMENT_PAYOUT_SCOPES,
    });
  });

  app.post("/v1/tournaments/list", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      return reply.send({ ...(await listTournaments({ recUserId })), isAdmin });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/get", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send({ ...(await getTournamentDetail({ recUserId, tournamentId: body.tournamentId })), isAdmin });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/create", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        title: z.string().trim().min(2).max(80),
        description: z.string().trim().max(500).optional().nullable(),
        game: gameSchema,
        bracketType: z.string().min(1),
        payoutScope: payoutSchema,
        winnerCoins: z.number().int().min(0).max(10_000_000),
        runnerUpCoins: z.number().int().min(0).max(10_000_000).optional(),
        semifinalistCoins: z.number().int().min(0).max(10_000_000).optional(),
      }).parse(request.body ?? {});
      return reply.send(await createTournament({
        recUserId: user.recUserId,
        title: body.title,
        description: body.description,
        game: body.game,
        bracketType: body.bracketType,
        payoutScope: body.payoutScope,
        winnerCoins: body.winnerCoins,
        runnerUpCoins: body.runnerUpCoins ?? 0,
        semifinalistCoins: body.semifinalistCoins ?? 0,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/cancel", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await cancelTournament(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lock", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await lockTournamentBracket(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/join", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await joinTournament({ recUserId, tournamentId: body.tournamentId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/leave", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await leaveTournament({ recUserId, tournamentId: body.tournamentId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/report-winner", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
        winnerUserId: z.string().uuid(),
      }).parse(request.body ?? {});
      return reply.send(await reportTournamentWinner({
        recUserId,
        isAdmin,
        tournamentId: body.tournamentId,
        matchId: body.matchId,
        winnerUserId: body.winnerUserId,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
