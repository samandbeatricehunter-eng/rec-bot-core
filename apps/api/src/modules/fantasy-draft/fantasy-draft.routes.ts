import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  endFantasyDraft,
  getFantasyDraftState,
  scheduleFantasyDraft,
  setFantasyDraftPickOrder,
  setFantasyDraftTimer,
  skipFantasyDraftPick,
  skipFantasyDraftToSpecificPick,
  startFantasyDraft,
} from "./fantasy-draft.service.js";

export async function fantasyDraftRoutes(app: FastifyInstance) {
  app.post("/v1/fantasy-draft/state", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Fantasy draft state requires a website session.");
      let isCommissioner = false;
      try {
        await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
        isCommissioner = true;
      } catch {
        isCommissioner = false;
      }
      return reply.send(await getFantasyDraftState(guildId, auth.discordId, isCommissioner));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/start", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        draftType: z.enum(["fantasy", "offseason", "rookie"]),
        pickTimerSeconds: z.number().int().positive().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Starting a draft requires a website session.");
      return reply.send(await startFantasyDraft(body.guildId, auth.discordId, { draftType: body.draftType, pickTimerSeconds: body.pickTimerSeconds }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/schedule", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), scheduledAt: z.string().datetime().nullable() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await scheduleFantasyDraft(body.guildId, body.scheduledAt));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/end", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await endFantasyDraft(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/set-pick-order", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        orderMode: z.enum(["standard", "snake"]),
        picks: z.array(z.object({ pickInRound: z.number().int().positive(), teamId: z.string().uuid() })).min(1),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await setFantasyDraftPickOrder(body.guildId, body.orderMode, body.picks));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/set-timer", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pickTimerSeconds: z.number().int().positive().nullable() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await setFantasyDraftTimer(body.guildId, body.pickTimerSeconds));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/skip-to-next", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await skipFantasyDraftPick(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/skip-to-specific", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        round: z.number().int().positive(),
        pickInRound: z.number().int().positive(),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await skipFantasyDraftToSpecificPick(body.guildId, body.round, body.pickInRound));
    } catch (error) { return sendError(reply, error); }
  });
}
