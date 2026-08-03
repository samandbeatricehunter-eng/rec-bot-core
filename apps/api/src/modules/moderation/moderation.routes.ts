import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { createLeagueBan, liftLeagueBan, liftLeagueRestriction, listLeagueModeration, listModerationTargets, setLeagueRestriction } from "./moderation.service.js";

export async function moderationRoutes(app: FastifyInstance) {
  app.post("/v1/moderation/targets", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await listModerationTargets(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/moderation/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await listLeagueModeration(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/moderation/ban", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), target: z.string().trim().min(1).max(80),
        scope: z.enum(["league", "owner_all_leagues"]), reason: z.string().trim().min(3).max(1000),
        appealInstructions: z.string().trim().max(1000).optional().nullable(),
        expiresAt: z.string().datetime().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await createLeagueBan({ ...body, actorDiscordId: auth.mode === "user" ? auth.discordId : null }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/moderation/ban/lift", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), banId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await liftLeagueBan({ ...body, actorDiscordId: auth.mode === "user" ? auth.discordId : null }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/moderation/restrict", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), target: z.string().trim().min(1).max(80),
        restrictionType: z.enum(["wagers", "highlights"]), reason: z.string().trim().min(3).max(1000),
        expiresAt: z.string().datetime().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await setLeagueRestriction({ ...body, actorDiscordId: auth.mode === "user" ? auth.discordId : null }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/moderation/restrict/lift", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), restrictionId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await liftLeagueRestriction({ ...body, actorDiscordId: auth.mode === "user" ? auth.discordId : null }));
    } catch (error) { return sendError(reply, error); }
  });
}
