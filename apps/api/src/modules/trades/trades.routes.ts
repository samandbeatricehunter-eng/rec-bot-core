import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { castTradeVote, createTradeBlockListing, forceCloseTradeVote, getTradeDetail, getTradeFairnessPreview, getTradeVoteStatus, listMyTrades, listPendingReviewTrades, listSeasonTradeCounts, listTradeableTeams, listTradeBlockListings, listTradeBlockPlayers, logCommissionerTrade, proposeTrade, respondToTrade, reviewTrade, setPlayerTradeBlock, withdrawTrade, withdrawTradeBlockListing } from "./trades.service.js";
import { searchTradeTargets, suggestTradeOffers } from "./trade-targets.service.js";

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

  app.post("/v1/trades/commissioner-log", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), proposingTeamId: z.string().uuid(), receivingTeamId: z.string().uuid(),
        offeredLegs: z.array(LegSchema).max(7), requestedLegs: z.array(LegSchema).max(7),
        offeredCoins: z.number().int().min(0).default(0), requestedCoins: z.number().int().min(0).default(0),
        classification: z.enum(["general", "blockbuster"]), note: z.string().max(1000).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Commissioner trade logging requires a website session.");
      return reply.send(await logCommissionerTrade({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/season-counts", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await listSeasonTradeCounts(guildId));
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

  app.post("/v1/trades/block-listings/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listTradeBlockListings(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/block-listings/create", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), legs: z.array(LegSchema).max(7),
        coins: z.number().int().min(0).default(0), lookingFor: z.string().min(1).max(300),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Posting to the trade block is website-only.");
      return reply.send(await createTradeBlockListing({ guildId: body.guildId, discordId: auth.discordId, legs: body.legs, coins: body.coins, lookingFor: body.lookingFor }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/block-listings/withdraw", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), listingId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Withdrawing a trade block listing is website-only.");
      return reply.send(await withdrawTradeBlockListing({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/detail", async (request, reply) => {
    try {
      const { guildId, tradeId } = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await getTradeDetail(guildId, tradeId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/fairness-preview", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), proposingTeamId: z.string().uuid(), receivingTeamId: z.string().uuid(),
        offeredLegs: z.array(LegSchema).max(7), requestedLegs: z.array(LegSchema).max(7),
        offeredCoins: z.number().int().min(0).default(0), requestedCoins: z.number().int().min(0).default(0),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await getTradeFairnessPreview(body.guildId, body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/targets/search", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), position: z.string().min(1),
        filters: z.array(z.object({ code: z.string().min(1), min: z.number().int().min(0).max(99) })).max(10).default([]),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trade Targets is website-only.");
      return reply.send(await searchTradeTargets(body.guildId, auth.discordId, { position: body.position, filters: body.filters }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/targets/suggest-offers", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), targetPlayerId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Trade Targets is website-only.");
      return reply.send(await suggestTradeOffers(body.guildId, auth.discordId, body.targetPlayerId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/vote-status", async (request, reply) => {
    try {
      const { guildId, tradeId } = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await getTradeVoteStatus(guildId, tradeId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/vote", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid(), vote: z.enum(["approve", "reject"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Trade voting requires a website session.");
      return reply.send(await castTradeVote({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/trades/vote-force-close", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), tradeId: z.string().uuid(), action: z.enum(["approve", "reject"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Trade voting requires a website session.");
      return reply.send(await forceCloseTradeVote({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });
}
