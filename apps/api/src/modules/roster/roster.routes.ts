import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { addTransferInPlayer, getTeamRoster, reinstatePlayer, ROSTER_DEPARTURE_STATUSES, setPlayerDeparture } from "./roster.service.js";

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
}
