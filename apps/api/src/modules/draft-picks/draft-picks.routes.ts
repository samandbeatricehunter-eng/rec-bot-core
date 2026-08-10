import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  deleteDraftPick,
  generateSeasonDraftPicks,
  listDraftPicksForLeague,
  listDraftPicksForTeam,
  setUpcomingDraftOrder,
  updateDraftPick,
  upsertManualDraftPick,
} from "./draft-picks.service.js";

export async function draftPicksRoutes(app: FastifyInstance) {
  app.post("/v1/draft-picks/team", async (request, reply) => {
    try {
      const { guildId, teamId } = z.object({ guildId: z.string().min(1), teamId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listDraftPicksForTeam(guildId, teamId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/draft-picks/list", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await listDraftPicksForLeague(guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/draft-picks/manual-upsert", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), seasonNumber: z.number().int().min(1), round: z.number().int().min(1).max(7),
        originalTeamId: z.string().uuid(), currentTeamId: z.string().uuid().optional(), pickNumber: z.number().int().min(1).max(32).nullable().optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Draft pick management requires a website session.");
      return reply.send(await upsertManualDraftPick({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/draft-picks/update", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), pickId: z.string().uuid(),
        pickNumber: z.number().int().min(1).max(32).nullable().optional(), currentTeamId: z.string().uuid().optional(), adminNotes: z.string().max(500).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Draft pick management requires a website session.");
      return reply.send(await updateDraftPick({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/draft-picks/delete", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), pickId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await deleteDraftPick(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/draft-picks/generate-season", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), seasonNumber: z.number().int().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Draft pick generation requires a website session.");
      return reply.send(await generateSeasonDraftPicks({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/draft-picks/set-order", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), seasonNumber: z.number().int().min(1), orderedTeamIds: z.array(z.string().uuid()).length(32) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Draft order management requires a website session.");
      return reply.send(await setUpcomingDraftOrder({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });
}
