import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getTradeDetail, listMyTrades, listPendingReviewTrades, listTradeableTeams, listTradeBlockPlayers, proposeTrade, respondToTrade, reviewTrade, setPlayerTradeBlock, withdrawTrade } from "./trades.service.js";

const LegSchema = z.union([
  z.object({ type: z.literal("player"), playerId: z.string().uuid() }),
  z.object({ type: z.literal("pick"), draftPickId: z.string().uuid() }),
]);

export async function tradesRoutes(app: FastifyInstance) {
  app.post("/v1/trades/propose", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), receivingTeamId: z.string().uuid(),
        offeredLegs: z.array(LegSchema).max(7), requestedLegs: z.array(LegSchema).max(7),
        offeredCoins: z.number().int().min(0).default(0), requestedCoins: z.number().int().min(0).default(0),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trades are website-only.");
      return reply.send(await proposeTrade({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/respond", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid(), action: z.enum(["accept", "decline"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trades are website-only.");
      return reply.send(await respondToTrade({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/withdraw", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trades are website-only.");
      return reply.send(await withdrawTrade({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/review", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid(), action: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Trade review requires a website session.");
      return reply.send(await reviewTrade({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/mine", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trades are website-only.");
      return reply.send(await listMyTrades(guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/pending-review", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await listPendingReviewTrades(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/teams", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listTradeableTeams(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/trade-block/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listTradeBlockPlayers(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/trade-block/set", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerId: z.string().uuid(), listed: z.boolean(), note: z.string().max(200).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trade-block management is website-only.");
      return reply.send(await setPlayerTradeBlock({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/detail", async (request, reply) => {
    try {
      const { guildId, tradeId } = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await getTradeDetail(guildId, tradeId));
    } catch (error) { return sendError(reply, error); }
  });
}
