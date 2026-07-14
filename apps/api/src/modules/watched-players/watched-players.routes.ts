import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { CLASS_YEARS, createWatchedPlayer, listWatchedPlayers, removeWatchedPlayer, updateWatchedPlayer } from "./watched-players.service.js";

const ClassYearSchema = z.enum(CLASS_YEARS).optional().nullable();

export async function watchedPlayersRoutes(app: FastifyInstance) {
  app.post("/v1/watched-players/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listWatchedPlayers(body.guildId, body.teamId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/create", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid(), playerName: z.string().trim().min(1).max(80), position: z.string().trim().min(1).max(20), classYear: ClassYearSchema }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await createWatchedPlayer(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/update", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), id: z.string().uuid(), playerName: z.string().trim().min(1).max(80), position: z.string().trim().min(1).max(20), classYear: ClassYearSchema }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await updateWatchedPlayer(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/remove", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), id: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await removeWatchedPlayer(body));
    } catch (error) { return sendError(reply, error); }
  });
}
