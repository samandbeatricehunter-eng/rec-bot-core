import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  TOURNAMENT_BRACKET_TYPES,
  TOURNAMENT_INJURY_OPTIONS,
  TOURNAMENT_PAYOUT_SCOPES,
  TOURNAMENT_PLAYSTYLES,
  TOURNAMENT_REQUIRED_RULES,
  defaultTournamentRules,
  parseTournamentRules,
  tournamentDifficultyOptions,
} from "@rec/shared";
import { sendError, ApiError } from "../../lib/errors.js";
import { isSiteAdminEmail, requireSiteAdmin } from "../../lib/site-admin.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { persistUploadedImageBuffer } from "../box-score/box-score.service.js";
import { requireLinkedRecUser } from "../site-leagues/site-leagues.service.js";
import {
  acceptTournamentWager,
  addTournamentHighlight,
  addTournamentUser,
  cancelTournament,
  createTournament,
  getTournamentDetail,
  joinTournament,
  leaveTournament,
  listMyTournamentHome,
  listTournamentHighlights,
  listTournamentTicker,
  listTournaments,
  listTournamentWagers,
  lockTournamentBracket,
  placeTournamentWager,
  reportTournamentWinner,
  resolveKnownGamerTag,
  reviewTournamentHighlight,
  setTournamentEntryStatus,
  setTournamentEventOpen,
  setTournamentMatchBetting,
  setTournamentMatchStream,
  setTournamentRegistrationOpen,
  tournamentTeamsForGame,
} from "./tournaments.service.js";

const gameSchema = z.enum(["madden_26", "madden_27", "cfb_27"]);
const payoutSchema = z.enum(["winner", "final_two", "final_four"]);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const rulesSchema = z.object({
  quarterLengthMinutes: z.number().int().min(4).max(15),
  difficulty: z.string().min(1),
  acceleratedClockEnabled: z.boolean(),
  acceleratedClockMinimumSeconds: z.number().int().min(10).max(25),
  injuries: z.enum(["on_standard", "on_reduced", "off"]),
  fatigueEnabled: z.boolean(),
  playstyle: z.enum(["simulation", "competitive", "arcade"]),
  wearAndTearEnabled: z.boolean().optional(),
});

async function identity(request: Parameters<typeof requireSiteUserSession>[0]) {
  const session = await requireSiteUserSession(request);
  const user = await requireLinkedRecUser(session.authUserId);
  return { session, recUserId: user.recUserId, isAdmin: isSiteAdminEmail(session.email) };
}

export async function tournamentRoutes(app: FastifyInstance) {
  app.post("/v1/tournaments/meta", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({ game: gameSchema.optional() }).parse(request.body ?? {});
      const game = body.game ?? "madden_27";
      return reply.send({
        isAdmin,
        knownGamerTag: await resolveKnownGamerTag(recUserId),
        bracketTypes: TOURNAMENT_BRACKET_TYPES,
        payoutScopes: TOURNAMENT_PAYOUT_SCOPES,
        playstyles: TOURNAMENT_PLAYSTYLES,
        injuries: TOURNAMENT_INJURY_OPTIONS,
        requiredRules: TOURNAMENT_REQUIRED_RULES,
        difficultyOptions: tournamentDifficultyOptions(game),
        defaultRules: defaultTournamentRules(game),
        teams: tournamentTeamsForGame(game),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/ticker", async (request, reply) => {
    try {
      await requireSiteUserSession(request);
      return reply.send(await listTournamentTicker());
    } catch (error) {
      return sendError(reply, error);
    }
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
        registrationOpensAt: z.string().min(1),
        registrationClosesAt: z.string().min(1),
        kickoffAt: z.string().min(1),
        timezone: z.string().trim().min(1).max(64).optional(),
        rules: rulesSchema,
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
        registrationOpensAt: body.registrationOpensAt,
        registrationClosesAt: body.registrationClosesAt,
        kickoffAt: body.kickoffAt,
        timezone: body.timezone,
        rules: parseTournamentRules(body.rules, body.game),
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
      const body = z.object({
        tournamentId: z.string().uuid(),
        teamAbbr: z.string().trim().min(1).max(8),
        gamerTag: z.string().trim().min(2).max(32),
      }).parse(request.body ?? {});
      return reply.send(await joinTournament({ recUserId, ...body }));
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

  app.post("/v1/tournaments/screenshot-upload", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const file = await request.file();
      if (!file || !imageTypes.has(file.mimetype)) throw new ApiError(400, "Upload a JPG, PNG, or WebP screenshot.");
      const buffer = await file.toBuffer();
      if (buffer.length > 15 * 1024 * 1024) throw new ApiError(413, "Image exceeds 15 MB.");
      const url = await persistUploadedImageBuffer(`tournaments/${recUserId}/${randomUUID()}`, buffer, file.mimetype);
      return reply.send({ url });
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
        resultMethod: z.enum(["final_screenshot", "concede"]),
        screenshotUrl: z.string().url(),
        concededByUserId: z.string().uuid().optional().nullable(),
        playerAScore: z.number().int().min(0).max(200).optional().nullable(),
        playerBScore: z.number().int().min(0).max(200).optional().nullable(),
      }).parse(request.body ?? {});
      return reply.send(await reportTournamentWinner({
        recUserId,
        isAdmin,
        tournamentId: body.tournamentId,
        matchId: body.matchId,
        winnerUserId: body.winnerUserId,
        resultMethod: body.resultMethod,
        screenshotUrl: body.screenshotUrl,
        concededByUserId: body.concededByUserId,
        playerAScore: body.playerAScore,
        playerBScore: body.playerBScore,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/registration-open", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ tournamentId: z.string().uuid(), open: z.boolean() }).parse(request.body ?? {});
      return reply.send(await setTournamentRegistrationOpen(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/event-open", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ tournamentId: z.string().uuid(), open: z.boolean() }).parse(request.body ?? {});
      return reply.send(await setTournamentEventOpen(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/add-user", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        tournamentId: z.string().uuid(),
        userId: z.string().uuid(),
        teamAbbr: z.string().trim().min(1).max(8),
        gamerTag: z.string().trim().min(2).max(32),
        into: z.enum(["registration", "tournament"]),
      }).parse(request.body ?? {});
      return reply.send(await addTournamentUser({ recUserId: user.recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/set-entry", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        tournamentId: z.string().uuid(),
        userId: z.string().uuid(),
        entryStatus: z.enum(["pending", "approved", "removed"]),
      }).parse(request.body ?? {});
      return reply.send(await setTournamentEntryStatus({ recUserId: user.recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/mine", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      return reply.send(await listMyTournamentHome({ recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/set-stream", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
        streamUrl: z.string().url(),
      }).parse(request.body ?? {});
      return reply.send(await setTournamentMatchStream({ recUserId, isAdmin, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/highlights/list", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await listTournamentHighlights({ recUserId, isAdmin, tournamentId: body.tournamentId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/highlights/add", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
        url: z.string().url(),
      }).parse(request.body ?? {});
      return reply.send(await addTournamentHighlight({ recUserId, isAdmin, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/highlights/review", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        highlightId: z.string().uuid(),
        status: z.enum(["approved", "rejected"]),
      }).parse(request.body ?? {});
      return reply.send(await reviewTournamentHighlight({ recUserId: user.recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/wagers/list", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid().optional(),
      }).parse(request.body ?? {});
      return reply.send(await listTournamentWagers(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/wagers/place", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
        market: z.enum(["house", "h2h"]),
        pickUserId: z.string().uuid(),
        stake: z.number().int().min(10).max(10_000),
      }).parse(request.body ?? {});
      return reply.send(await placeTournamentWager({ recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/wagers/accept", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ wagerId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await acceptTournamentWager({ recUserId, wagerId: body.wagerId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/wagers/betting-open", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
        open: z.boolean(),
      }).parse(request.body ?? {});
      return reply.send(await setTournamentMatchBetting(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
