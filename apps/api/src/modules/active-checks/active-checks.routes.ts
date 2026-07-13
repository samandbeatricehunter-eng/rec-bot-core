import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createActiveCheckEvent, finishActiveCheckReview, getActiveCheckReview, keepActiveCheckUsers, listOpenActiveCheckEvents, markActiveCheckBooted, markActiveCheckNeedsReview, settleActiveCheckEvent } from "./active-checks.service.js";

// Active check routes below are keyed by eventId, not guildId, so the combined guard's
// usual "claimed guildId matches session" check only proves the caller belongs to *some*
// guild — it doesn't prove this event belongs to that guild. Mirrors box-score.routes.ts's
// assertSubmissionInSessionGuild: 404 rather than 403 on mismatch, and reuses
// getActiveCheckReview (which every one of these routes needs anyway) rather than adding a
// second lookup.
async function assertEventInSessionGuild(guildId: string, eventId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const review = await getActiveCheckReview(eventId);
  if (context.leagueId !== review.event.league_id) throw new ApiError(404, "Active check event not found.");
  return review;
}

export async function activeCheckRoutes(app: FastifyInstance) {
  app.post("/v1/active-checks/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        discordChannelId: z.string().min(1),
        discordMessageId: z.string().min(1),
        createdByDiscordId: z.string().min(1),
        closesAt: z.string().min(1),
      }).parse(request.body);
      return reply.send(await createActiveCheckEvent(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/open", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await listOpenActiveCheckEvents());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/settle", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        eventId: z.string().uuid(),
        activeDiscordIds: z.array(z.string()).default([]),
        kickMeDiscordIds: z.array(z.string()).default([]),
      }).parse(request.body);
      return reply.send(await settleActiveCheckEvent(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/review", async (request, reply) => {
    try {
      // guildId is optional because the bot's existing calls don't send it (bot-mode auth
      // never checks it — see resolveGuildId below); the web dashboard always sends it.
      const body = z.object({ guildId: z.string().min(1).optional(), eventId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") return reply.send(await assertEventInSessionGuild(auth.guildId, body.eventId));
      return reply.send(await getActiveCheckReview(body.eventId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/keep", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1).optional(),
        eventId: z.string().uuid(),
        discordIds: z.array(z.string()).default([]),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") await assertEventInSessionGuild(auth.guildId, body.eventId);
      return reply.send(await keepActiveCheckUsers(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/booted", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1).optional(),
        eventId: z.string().uuid(),
        discordIds: z.array(z.string()).default([]),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") await assertEventInSessionGuild(auth.guildId, body.eventId);
      return reply.send(await markActiveCheckBooted(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/finish-review", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        eventId: z.string().uuid(),
        reviewedByDiscordId: z.string().min(1).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode === "user") await assertEventInSessionGuild(auth.guildId, body.eventId);
      return reply.send(await finishActiveCheckReview({ eventId: body.eventId, reviewedByDiscordId: auth.mode === "user" ? auth.discordId : (body.reviewedByDiscordId ?? "bot") }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/needs-review", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ eventId: z.string().uuid(), reason: z.string().min(1) }).parse(request.body);
      return reply.send(await markActiveCheckNeedsReview(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
