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
  createTournamentHighlightDirectUpload,
  getTournamentHighlightUploadStatus,
  markTournamentHighlightUploadReceived,
} from "./tournaments-media.service.js";
import {
  acceptTournamentWager,
  getTournamentMatchWagerOptions,
  listTournamentWagers,
  placeTournamentWager,
} from "./tournaments-wagers.service.js";
import {
  cloneRosterLibrary,
  createRosterLibrary,
  deleteRosterLibrary,
  getRosterLibrary,
  importRosterLibraryCsv,
  listRosterLibraries,
  setRosterLibraryBaseline,
} from "./roster-libraries.service.js";
import {
  beginLibraryEaLogin,
  bindLibraryEaLeague,
  getLibraryEaConnectionStatus,
  importLibraryRosters,
  listLibraryEaLeagues,
  selectLibraryEaPersona,
  submitLibraryEaCode,
} from "./roster-library-ea.service.js";
import {
  assignLotteryTeam,
  getTournamentLottery,
  pickLotteryTeam,
  runTournamentLotteryNow,
  scheduleTournamentLottery,
  skipLotteryPick,
} from "./tournament-lottery.service.js";
import {
  checkInMatch,
  markCantMakeMatch,
  markTournamentMatchOver,
  markTournamentMatchStarted,
  proposeTime as proposeMatchSchedulingTime,
  requestReschedule as requestMatchReschedule,
  resetMatchScheduling,
  respondToProposal as respondToMatchSchedulingProposal,
} from "./tournament-match-scheduling.service.js";
import {
  addTournamentUser,
  approveTournamentMatchResult,
  cancelTournament,
  createTournament,
  getTournamentDetail,
  joinTournament,
  leaveTournament,
  listMyTournamentHome,
  listTournamentHighlights,
  listTournamentMatchReviewQueue,
  listTournamentRounds,
  listTournamentTicker,
  listTournaments,
  lockTournamentBracket,
  rejectTournamentMatchResult,
  reportTournamentWinner,
  resolveKnownGamerTag,
  reviewTournamentHighlight,
  setTournamentEntryStatus,
  setTournamentEventOpen,
  setTournamentMatchBetting,
  setTournamentMatchStream,
  setTournamentRegistrationOpen,
  setTournamentRoundSchedule,
  tournamentTeamsForGame,
  updateTournament,
  uploadTournamentLogo,
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
      return reply.send({ ...(await listTournaments({ recUserId, isAdmin })), isAdmin });
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
        rosterLibraryId: z.string().uuid().optional().nullable(),
        teamSelectionMode: z.enum(["typed", "claim_pool"]).optional(),
        claimOrderMode: z.enum(["first_come", "lottery"]).optional().nullable(),
        scheduleMode: z.enum(["single_kickoff", "per_round"]).optional(),
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
        rosterLibraryId: body.rosterLibraryId,
        teamSelectionMode: body.teamSelectionMode,
        claimOrderMode: body.claimOrderMode,
        scheduleMode: body.scheduleMode,
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/update", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        title: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(500).optional().nullable(),
        payoutScope: payoutSchema.optional(),
        winnerCoins: z.number().int().min(0).max(10_000_000).optional(),
        runnerUpCoins: z.number().int().min(0).max(10_000_000).optional(),
        semifinalistCoins: z.number().int().min(0).max(10_000_000).optional(),
        registrationOpensAt: z.string().min(1).optional(),
        registrationClosesAt: z.string().min(1).optional(),
        kickoffAt: z.string().min(1).optional(),
        timezone: z.string().trim().min(1).max(64).optional(),
        rules: rulesSchema.optional(),
        rosterLibraryId: z.string().uuid().optional().nullable(),
        teamSelectionMode: z.enum(["typed", "claim_pool"]).optional(),
        claimOrderMode: z.enum(["first_come", "lottery"]).optional().nullable(),
        scheduleMode: z.enum(["single_kickoff", "per_round"]).optional(),
        schedulingWindowHours: z.number().int().min(1).max(24 * 30).optional(),
      }).parse(request.body ?? {});
      return reply.send(await updateTournament(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/upload-logo", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const tournamentId = z.string().uuid().parse((request.query as { tournamentId?: string })?.tournamentId);
      const file = await request.file();
      if (!file) throw new ApiError(400, "Choose a tournament logo image.");
      return reply.send(await uploadTournamentLogo({ tournamentId, buffer: await file.toBuffer(), contentType: file.mimetype }));
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
      const body = z.object({ tournamentId: z.string().uuid(), manualByeUserIds: z.array(z.string().uuid()).optional() }).parse(request.body ?? {});
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
        teamAbbr: z.string().trim().min(1).max(8).optional().nullable(),
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
        resultMethod: z.enum(["final_screenshot", "concede", "opponent_quit"]),
        // Only the "final score screenshot" method actually has a screenshot to attach —
        // a concede/quit-out report has nothing to upload.
        screenshotUrl: z.string().url().optional().nullable(),
        concededByUserId: z.string().uuid().optional().nullable(),
        playerAScore: z.number().int().min(0).max(200).optional().nullable(),
        playerBScore: z.number().int().min(0).max(200).optional().nullable(),
      }).refine((value) => value.resultMethod !== "final_screenshot" || Boolean(value.screenshotUrl), {
        message: "A screenshot is required for the final-score-screenshot result.",
        path: ["screenshotUrl"],
      }).parse(request.body ?? {});
      return reply.send(await reportTournamentWinner({
        recUserId,
        isAdmin,
        tournamentId: body.tournamentId,
        matchId: body.matchId,
        winnerUserId: body.winnerUserId,
        resultMethod: body.resultMethod,
        screenshotUrl: body.screenshotUrl ?? null,
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

  app.post("/v1/tournaments/highlights/direct-upload", async (request, reply) => {
    try {
      const { recUserId, isAdmin } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
        fileName: z.string().trim().max(120).optional().nullable(),
      }).parse(request.body ?? {});
      return reply.send(await createTournamentHighlightDirectUpload({ recUserId, isAdmin, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/highlights/upload-received", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        highlightId: z.string().uuid(),
      }).parse(request.body ?? {});
      return reply.send(await markTournamentHighlightUploadReceived({ recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/highlights/status", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        highlightId: z.string().uuid(),
      }).parse(request.body ?? {});
      return reply.send(await getTournamentHighlightUploadStatus({ recUserId, ...body }));
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

  app.post("/v1/tournaments/wagers/options", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        matchId: z.string().uuid(),
      }).parse(request.body ?? {});
      return reply.send(await getTournamentMatchWagerOptions(body));
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
        wagerKind: z.enum(["house", "peer"]),
        marketKey: z.string().min(1),
        pick: z.string().min(1),
        stake: z.number().int().min(10).max(50_000),
        isParlay: z.boolean().optional(),
        legs: z.array(z.object({
          marketKey: z.string().min(1),
          pick: z.string().min(1),
        })).max(3).optional(),
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

  app.post("/v1/tournaments/roster-libraries/list", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ game: gameSchema.optional() }).parse(request.body ?? {});
      return reply.send(await listRosterLibraries({ game: body.game }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/get", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ libraryId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await getRosterLibrary(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/create", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        game: gameSchema,
        name: z.string().trim().min(2).max(80),
        sourceNote: z.string().trim().max(300).optional().nullable(),
      }).parse(request.body ?? {});
      return reply.send(await createRosterLibrary({ recUserId: user.recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/import", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({
        libraryId: z.string().uuid(),
        csvText: z.string().min(1).max(3_000_000),
      }).parse(request.body ?? {});
      return reply.send(await importRosterLibraryCsv(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/clone", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        libraryId: z.string().uuid(),
        newName: z.string().trim().min(2).max(80),
      }).parse(request.body ?? {});
      return reply.send(await cloneRosterLibrary({ recUserId: user.recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/set-baseline", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({
        libraryId: z.string().uuid(),
        isBaseline: z.boolean(),
      }).parse(request.body ?? {});
      return reply.send(await setRosterLibraryBaseline(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/delete", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ libraryId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await deleteRosterLibrary(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/login", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({ libraryId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await beginLibraryEaLogin(body.libraryId, user.recUserId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/code", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({ libraryId: z.string().uuid(), pasted: z.string().min(1) }).parse(request.body ?? {});
      return reply.send(await submitLibraryEaCode(body.libraryId, user.recUserId, body.pasted));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/persona", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const user = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        libraryId: z.string().uuid(),
        pendingAuthId: z.string().uuid(),
        personaId: z.number(),
      }).parse(request.body ?? {});
      return reply.send(await selectLibraryEaPersona(body.libraryId, user.recUserId, body.pendingAuthId, body.personaId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/status", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ libraryId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await getLibraryEaConnectionStatus(body.libraryId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/leagues", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ libraryId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send({ leagues: await listLibraryEaLeagues(body.libraryId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/bind", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ libraryId: z.string().uuid(), eaLeagueId: z.number() }).parse(request.body ?? {});
      return reply.send(await bindLibraryEaLeague(body.libraryId, body.eaLeagueId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/roster-libraries/ea/import", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ libraryId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await importLibraryRosters(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/matches/review-queue", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      return reply.send(await listTournamentMatchReviewQueue());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/matches/approve", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const admin = await requireLinkedRecUser(session.authUserId);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await approveTournamentMatchResult({ recUserId: admin.recUserId, matchId: body.matchId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/matches/reject", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const admin = await requireLinkedRecUser(session.authUserId);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await rejectTournamentMatchResult({ recUserId: admin.recUserId, matchId: body.matchId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/rounds/list", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await listTournamentRounds(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/rounds/schedule", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        bracketSide: z.enum(["winners", "losers", "grand_final"]),
        round: z.number().int().min(1),
        scheduledAt: z.string().min(1),
      }).parse(request.body ?? {});
      return reply.send(await setTournamentRoundSchedule(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Self-serve match scheduling (propose/accept/counter) -- site-only, participant-gated inside
  // the service functions themselves, same pattern as the league's matchup scheduling routes.
  app.post("/v1/tournaments/scheduling/propose", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid(), proposedForUtc: z.string().min(1) }).parse(request.body ?? {});
      return reply.send(await proposeMatchSchedulingTime({ matchId: body.matchId, recUserId, proposedForUtc: body.proposedForUtc }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/respond", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({
        matchId: z.string().uuid(),
        proposalId: z.string().uuid(),
        action: z.enum(["accept", "counter", "withdraw", "reject"]),
        counterForUtc: z.string().min(1).optional(),
      }).parse(request.body ?? {});
      return reply.send(await respondToMatchSchedulingProposal({ ...body, recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/request-reschedule", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await requestMatchReschedule({ matchId: body.matchId, recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/reset", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await resetMatchScheduling(body.matchId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/check-in", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await checkInMatch({ matchId: body.matchId, recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/game-started", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await markTournamentMatchStarted({ matchId: body.matchId, recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/game-over", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await markTournamentMatchOver({ matchId: body.matchId, recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/scheduling/cant-make-game", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await markCantMakeMatch({ matchId: body.matchId, recUserId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lottery/get", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await getTournamentLottery(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lottery/schedule", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        scheduledAt: z.string().min(1),
      }).parse(request.body ?? {});
      return reply.send(await scheduleTournamentLottery(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lottery/run-now", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await runTournamentLotteryNow(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lottery/pick", async (request, reply) => {
    try {
      const { recUserId } = await identity(request);
      const body = z.object({
        tournamentId: z.string().uuid(),
        teamAbbr: z.string().trim().min(1).max(8),
        gamerTag: z.string().trim().min(2).max(32),
      }).parse(request.body ?? {});
      return reply.send(await pickLotteryTeam({ recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lottery/assign", async (request, reply) => {
    try {
      const session = await requireSiteAdmin(request);
      const admin = await requireLinkedRecUser(session.authUserId);
      const body = z.object({
        tournamentId: z.string().uuid(),
        userId: z.string().uuid(),
        teamAbbr: z.string().trim().min(1).max(8),
        gamerTag: z.string().trim().min(2).max(32),
      }).parse(request.body ?? {});
      return reply.send(await assignLotteryTeam({ adminRecUserId: admin.recUserId, ...body }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/tournaments/lottery/skip", async (request, reply) => {
    try {
      await requireSiteAdmin(request);
      const body = z.object({ tournamentId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await skipLotteryPick(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
