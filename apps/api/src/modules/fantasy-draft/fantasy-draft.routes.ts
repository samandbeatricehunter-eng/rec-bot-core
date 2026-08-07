import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  addFantasyDraftCustomPlayer,
  commenceFantasyDraft,
  concludeFantasyDraft,
  getFantasyDraftState,
  logFantasyDraftPick,
  logFantasyDraftWrapupPick,
  removeFantasyDraftPoolPlayer,
  saveFantasyDraftBoard,
  scheduleFantasyDraft,
  setFantasyDraftPickOrder,
  skipFantasyDraftToEnd,
  undoFantasyDraftPick,
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

  app.post("/v1/fantasy-draft/board/save", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerIds: z.array(z.string().uuid()).max(500) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Saving a draft board requires a website session.");
      return reply.send(await saveFantasyDraftBoard(body.guildId, auth.discordId, body.playerIds));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/schedule", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), scheduledAt: z.string().datetime().optional().nullable() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Scheduling the fantasy draft requires a website session.");
      return reply.send(await scheduleFantasyDraft(body.guildId, auth.discordId, body.scheduledAt ?? ""));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/commence", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Commencing the fantasy draft requires a website session.");
      return reply.send(await commenceFantasyDraft(guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/set-pick-order", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        orderMode: z.enum(["standard", "snake"]),
        picks: z.array(z.object({ pickInRound: z.number().int().min(1).max(32), teamId: z.string().uuid() })),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Setting the pick order requires a website session.");
      return reply.send(await setFantasyDraftPickOrder(body.guildId, auth.discordId, body.orderMode, body.picks));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/add-custom-player", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        position: z.string().min(2).max(3),
        jerseyNumber: z.number().int().min(0).max(99).optional().nullable(),
        archetype: z.string().max(40).optional().nullable(),
        devTrait: z.string().max(20).optional().nullable(),
        overallRating: z.number().int().min(0).max(99).optional().nullable(),
        attributes: z.record(z.string(), z.number()),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Adding a custom draft player requires a website session.");
      return reply.send(await addFantasyDraftCustomPlayer(body.guildId, auth.discordId, body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/remove-pool-player", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await removeFantasyDraftPoolPlayer(body.guildId, body.playerId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/pick", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Logging a pick requires a website session.");
      return reply.send(await logFantasyDraftPick(body.guildId, auth.discordId, body.playerId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/wrapup-pick", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerId: z.string().uuid(), teamId: z.string().uuid().optional().nullable() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Logging a wrap-up pick requires a website session.");
      let isCommissioner = false;
      try {
        await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
        isCommissioner = true;
      } catch {
        isCommissioner = false;
      }
      return reply.send(await logFantasyDraftWrapupPick(body.guildId, auth.discordId, body.playerId, body.teamId ?? null, isCommissioner));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/undo", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await undoFantasyDraftPick(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/skip-to-end", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await skipFantasyDraftToEnd(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/fantasy-draft/conclude", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await concludeFantasyDraft(guildId));
    } catch (error) { return sendError(reply, error); }
  });
}
