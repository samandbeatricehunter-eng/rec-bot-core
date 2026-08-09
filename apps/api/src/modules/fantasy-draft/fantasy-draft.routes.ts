import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  addFantasyDraftCustomPlayer,
  commenceFantasyDraft,
  concludeFantasyDraft,
  getFantasyDraftCheckins,
  getFantasyDraftSelfCheckinStatus,
  getFantasyDraftState,
  logFantasyDraftPick,
  logFantasyDraftWrapupPick,
  removeFantasyDraftPoolPlayer,
  requestFantasyDraftPick,
  resolveFantasyDraftPickRequest,
  saveFantasyDraftBoard,
  scheduleFantasyDraft,
  setFantasyDraftPickOrder,
  setFantasyDraftSelfCheckin,
  setFantasyDraftTeamCheckin,
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

  // Commissioner-only: logs a pick immediately for whichever team is on the clock, no
  // approval step (they're the one confirming it happened in-game). Non-commissioners submit
  // a request instead — see /v1/fantasy-draft/pick/request below.
  app.post("/v1/fantasy-draft/pick", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Logging a pick requires a website session.");
      return reply.send(await logFantasyDraftPick(body.guildId, auth.discordId, body.playerId));
    } catch (error) { return sendError(reply, error); }
  });

  // Non-commissioner draft request: only valid when the caller's own team is on the clock.
  // Sits pending until the commissioner approves or denies it.
  app.post("/v1/fantasy-draft/pick/request", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), playerId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new Error("Requesting a pick requires a website session.");
      return reply.send(await requestFantasyDraftPick(body.guildId, auth.discordId, body.playerId));
    } catch (error) { return sendError(reply, error); }
  });

  // Commissioner approves/denies a pending pick request.
  app.post("/v1/fantasy-draft/pick/resolve-request", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), requestId: z.string().uuid(), action: z.enum(["approve", "deny"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Resolving a pick request requires a commissioner session.");
      return reply.send(await resolveFantasyDraftPickRequest(body.guildId, auth.discordId, body.requestId, body.action));
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

  // Backs the /draft ephemeral Discord command: the caller's own team + check-in status only.
  app.post("/v1/fantasy-draft/check-in/status", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      const discordId = auth.mode === "user" ? auth.discordId : body.discordId;
      if (!discordId) throw new Error("discordId is required for bot check-in status calls.");
      return reply.send(await getFantasyDraftSelfCheckinStatus(body.guildId, discordId));
    } catch (error) { return sendError(reply, error); }
  });

  // Self-service check-in/out from the site or the Discord embed buttons. Any league member
  // toggles their own assigned team. Bot calls (embed buttons) pass the clicking user's
  // discordId explicitly; website sessions resolve it from auth.
  app.post("/v1/fantasy-draft/check-in", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), checkedIn: z.boolean(), discordId: z.string().min(1).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "user") {
        return reply.send(await setFantasyDraftSelfCheckin(body.guildId, auth.discordId, body.checkedIn));
      }
      if (!body.discordId) throw new Error("discordId is required for bot check-in calls.");
      return reply.send(await setFantasyDraftSelfCheckin(body.guildId, body.discordId, body.checkedIn));
    } catch (error) { return sendError(reply, error); }
  });

  // Commissioner override of any team's check-in status (site panel, or bot embed buttons
  // acting for the commissioner).
  app.post("/v1/fantasy-draft/check-in/set", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid(), checkedIn: z.boolean() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new Error("Updating a team's check-in requires a commissioner session.");
      return reply.send(await setFantasyDraftTeamCheckin(body.guildId, auth.discordId, body.teamId, body.checkedIn));
    } catch (error) { return sendError(reply, error); }
  });

  // Read-only snapshot of team check-in status for the bot's live embed.
  app.post("/v1/fantasy-draft/check-ins", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await getFantasyDraftCheckins(guildId));
    } catch (error) { return sendError(reply, error); }
  });
}
