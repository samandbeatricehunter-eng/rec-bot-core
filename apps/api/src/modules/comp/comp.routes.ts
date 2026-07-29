import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError, ApiError } from "../../lib/errors.js";
import { requireSiteUserSession } from "../../lib/site-auth.js";
import { parseCfbBoxScoreImages } from "../box-score/box-score-cfb.parser.js";
import { parseBoxScoreImages } from "../box-score/box-score.parser.js";
import { persistUploadedImageBuffer } from "../box-score/box-score.service.js";
import { getUserCompDetail, listConnectedUsers } from "./comp.service.js";
import {
  cancelCompMatch,
  compUserId,
  concedeCompMatch,
  getCompProfile,
  getCompState,
  joinCompQueue,
  leaveCompQueue,
  listDefaultCompTeams,
  reportCompIssue,
  requestCompMatch,
  respondCompMatch,
  respondCompReport,
  reviewCompBoxScore,
  saveCompProfile,
  selectCompTeam,
  sendCompMessage,
  shareCompStream,
  submitCompBoxScore,
} from "./matchmaking.service.js";

const gameSchema = z.enum(["madden_26", "madden_27", "cfb_27"]);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

async function identity(request: Parameters<typeof requireSiteUserSession>[0]) {
  const session = await requireSiteUserSession(request);
  return { session, userId: await compUserId(session.authUserId) };
}

export async function compRoutes(app: FastifyInstance) {
  app.post("/v1/comp/users/list", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ page: z.number().int().min(1).optional() }).parse(request.body ?? {});
      return reply.send(await listConnectedUsers(body));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/users/detail", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ userId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await getUserCompDetail(body.userId));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/profile/get", async (request, reply) => {
    try { const { userId } = await identity(request); return reply.send(await getCompProfile(userId)); }
    catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/profile/save", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({
        console: z.enum(["xbox", "ps5", "pc"]),
        gamerTag: z.string().trim().min(2).max(40),
        crossPlayEnabled: z.boolean(),
      }).parse(request.body ?? {});
      return reply.send(await saveCompProfile({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/state", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const { game } = z.object({ game: gameSchema }).parse(request.body ?? {});
      return reply.send(await getCompState(userId, game));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/queue/join", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({
        game: gameSchema, rosterMode: z.enum(["default", "cut"]),
        quarterLength: z.number().int().min(4).max(8).nullable(),
        acceleratedClock: z.boolean().nullable(),
        acceleratedClockMinimum: z.number().int().min(15).max(25).nullable(),
      }).parse(request.body ?? {});
      return reply.send(await joinCompQueue({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/queue/leave", async (request, reply) => {
    try { const { userId } = await identity(request); return reply.send(await leaveCompQueue(userId)); }
    catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/match/request", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const { opponentUserId } = z.object({ opponentUserId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await requestCompMatch({ userId, opponentUserId }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/match/respond", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid(), accept: z.boolean() }).parse(request.body ?? {});
      return reply.send(await respondCompMatch({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/match/teams", async (request, reply) => {
    try { await identity(request); const { game } = z.object({ game: gameSchema }).parse(request.body ?? {}); return reply.send(await listDefaultCompTeams(game)); }
    catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/match/select-team", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid(), teamId: z.string().uuid() }).parse(request.body ?? {});
      return reply.send(await selectCompTeam({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/chat/send", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(request.body ?? {});
      return reply.send(await sendCompMessage({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/stream/share", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({ matchId: z.string().uuid(), streamUrl: z.string().url().refine((v) => v.startsWith("https://")) }).parse(request.body ?? {});
      return reply.send(await shareCompStream({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/match/cancel", async (request, reply) => {
    try { const { userId } = await identity(request); const { matchId } = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {}); return reply.send(await cancelCompMatch({ userId, matchId })); }
    catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/match/concede", async (request, reply) => {
    try { const { userId } = await identity(request); const { matchId } = z.object({ matchId: z.string().uuid() }).parse(request.body ?? {}); return reply.send(await concedeCompMatch({ userId, matchId })); }
    catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/report/create", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({
        matchId: z.string().uuid(),
        type: z.enum(["server_issue", "dashed_first_half", "quit_out", "inappropriate_behavior", "other"]),
        details: z.string().trim().max(2000).nullable().optional(),
        evidenceUrls: z.array(z.string().url()).max(5).optional(),
      }).parse(request.body ?? {});
      if (body.type !== "server_issue" && !body.details) throw new ApiError(400, "Describe the issue.");
      return reply.send(await reportCompIssue({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/report/respond", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({ reportId: z.string().uuid(), confirm: z.boolean(), response: z.string().max(2000).nullable().optional() }).parse(request.body ?? {});
      return reply.send(await respondCompReport({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/box-score/upload", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const file = await request.file();
      if (!file || !imageTypes.has(file.mimetype)) throw new ApiError(400, "Upload a JPG, PNG, or WebP image.");
      const buffer = await file.toBuffer();
      if (buffer.length > 15 * 1024 * 1024) throw new ApiError(413, "Image exceeds 15 MB.");
      const url = await persistUploadedImageBuffer(`comp/${userId}/${randomUUID()}`, buffer, file.mimetype);
      return reply.send({ url });
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/box-score/parse", async (request, reply) => {
    try {
      await identity(request);
      const body = z.object({ game: gameSchema, imageUrls: z.array(z.string().url()).min(2).max(6) }).parse(request.body ?? {});
      const parsed = body.game === "cfb_27"
        ? await parseCfbBoxScoreImages(body.imageUrls)
        : await parseBoxScoreImages(body.imageUrls);
      return reply.send({ parsed });
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/box-score/submit", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({
        matchId: z.string().uuid(), imageUrls: z.array(z.string().url()).min(2).max(6),
        parsedPayload: z.record(z.string(), z.unknown()), correctedPayload: z.record(z.string(), z.unknown()),
      }).parse(request.body ?? {});
      return reply.send(await submitCompBoxScore({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/comp/box-score/review", async (request, reply) => {
    try {
      const { userId } = await identity(request);
      const body = z.object({
        submissionId: z.string().uuid(), action: z.enum(["approve", "correct", "deny"]),
        correctedPayload: z.record(z.string(), z.unknown()).optional(), note: z.string().max(2000).nullable().optional(),
      }).parse(request.body ?? {});
      return reply.send(await reviewCompBoxScore({ userId, ...body }));
    } catch (error) { return sendError(reply, error); }
  });
}
