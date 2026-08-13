import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { addRosterPlayer, addTransferInPlayer, assignRosterPlayer, deleteRosterPlayer, getTeamRoster, listRosterPool, reinstatePlayer, releaseRosterPlayer, ROSTER_DEPARTURE_STATUSES, setPlayerDeparture, updateRosterPlayer, uploadPlayerPhoto } from "./roster.service.js";
import { approveRosterAddRequest, denyRosterAddRequest, listRosterAddRequests, submitRosterAddRequest } from "./roster-add-requests.service.js";

export async function teamRosterRoutes(app: FastifyInstance) {
  app.post("/v1/roster/team", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        teamId: z.string().uuid().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await getTeamRoster({ guildId: body.guildId, discordId: body.discordId, teamId: body.teamId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Roster pool editor (plan) — the commissioner's entire unassigned pool, position-grouped
  // like the team roster with an optional name search / exact-position filter. Read is member-
  // level; assign/release/update below are the commissioner/team-ownership-gated mutations.
  app.post("/v1/roster/pool", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        search: z.string().max(120).optional().nullable(),
        positionGroup: z.string().max(8).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await listRosterPool({ guildId: body.guildId, discordId: body.discordId, search: body.search, positionGroup: body.positionGroup }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/pool/assign", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
        teamId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await assignRosterPlayer({ guildId: body.guildId, discordId: body.discordId, playerId: body.playerId, teamId: body.teamId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/pool/release", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await releaseRosterPlayer({ guildId: body.guildId, discordId: body.discordId, playerId: body.playerId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/player/update", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
        firstName: z.string().max(40).optional(),
        lastName: z.string().max(40).optional(),
        position: z.string().max(8).optional(),
        jerseyNumber: z.number().int().min(0).max(99).optional().nullable(),
        archetype: z.string().max(80).optional().nullable(),
        devTrait: z.string().max(20).optional().nullable(),
        classYear: z.string().max(8).optional().nullable(),
        overallRating: z.number().int().min(0).max(99).optional().nullable(),
        heightInches: z.number().int().min(48).max(90).optional().nullable(),
        weightLbs: z.number().int().min(100).max(450).optional().nullable(),
        handedness: z.enum(["left", "right"]).optional().nullable(),
        attributes: z.record(z.string(), z.number().int().min(0).max(99)).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await updateRosterPlayer({ ...body, discordId: body.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // League Mgmt headshot upload (plan §11) — commissioner-facing photo control in the roster
  // editor. Same session/auth conventions as every other roster lifecycle route; the service
  // gates to the player's own team coach or a co-commissioner+.
  app.post("/v1/roster/player/photo", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
        contentType: z.string().min(1),
        imageBase64: z.string().min(1),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      const imageBuffer = Buffer.from(body.imageBase64, "base64");
      return reply.send(await uploadPlayerPhoto({ guildId: body.guildId, discordId: body.discordId, playerId: body.playerId, contentType: body.contentType, imageBuffer }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/lifecycle/departure", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
        status: z.enum(ROSTER_DEPARTURE_STATUSES),
        note: z.string().max(280).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await setPlayerDeparture({ guildId: body.guildId, discordId: body.discordId, playerId: body.playerId, status: body.status, note: body.note }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/lifecycle/reinstate", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await reinstatePlayer({ guildId: body.guildId, discordId: body.discordId, playerId: body.playerId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/lifecycle/delete", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await deleteRosterPlayer({ guildId: body.guildId, discordId: body.discordId, playerId: body.playerId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/lifecycle/transfer-in", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        teamId: z.string().uuid(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        position: z.string().min(1),
        classYear: z.enum(["FR", "SO", "JR", "SR"]).optional().nullable(),
        overallRating: z.number().int().min(0).max(99).optional().nullable(),
        heightInches: z.number().int().min(60).max(90).optional().nullable(),
        weightLbs: z.number().int().min(100).max(450).optional().nullable(),
        handedness: z.enum(["left", "right"]).optional().nullable(),
        note: z.string().max(280).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await addTransferInPlayer({ ...body, discordId: body.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commissioner-direct add (Edit Rosters page — any team, no approval needed since the
  // commissioner is the approver themselves).
  app.post("/v1/roster/add-player", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        teamId: z.string().uuid(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        position: z.string().min(1),
        heightInches: z.number().int().min(60).max(84).optional().nullable(),
        weightLbs: z.number().int().min(100).max(450).optional().nullable(),
        handedness: z.enum(["left", "right"]).optional().nullable(),
        overallRating: z.number().int().min(0).max(99).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await addRosterPlayer({ ...body, discordId: body.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // "Edit Roster" My Team quick action — commissioners get an immediate add, everyone else
  // queues a pending request for commissioner review.
  app.post("/v1/roster/add-requests/submit", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        position: z.string().min(1),
        heightInches: z.number().int().min(60).max(84).optional().nullable(),
        weightLbs: z.number().int().min(100).max(450).optional().nullable(),
        overallRating: z.number().int().min(0).max(99).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode === "bot" && !body.discordId) requireInternalApiKey(request);
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await submitRosterAddRequest({ ...body, discordId: body.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/add-requests/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listRosterAddRequests(body.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/add-requests/approve", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        requestId: z.string().uuid(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await approveRosterAddRequest({ ...body, discordId: body.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roster/add-requests/deny", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        requestId: z.string().uuid(),
        reason: z.string().min(1).max(500),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") body.discordId = auth.discordId;
      if (!body.discordId) throw new Error("Missing Discord id.");
      return reply.send(await denyRosterAddRequest({ ...body, discordId: body.discordId }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
