import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  createOverride, deleteOverride, getAvailabilityProfileByDiscordId, getEffectiveAvailability,
  getRecurringWindows, listOverrides, setAvailabilityVisibility, setRecurringWindowsForDay, setTimezone,
} from "./availability.service.js";
import {
  checkIn, computeUserFacingStatus, getSchedulingSuggestions, markResponded, proposeTime,
  requestForceWin, requestReschedule, respondToProposal,
} from "./matchup-scheduling.service.js";
import { userIdFromDiscordId } from "./shared.js";

// Every action here is reachable identically from Discord (bot mode, discordId in the body,
// trusted) and the site (user mode, session-resolved discordId) -- one scheduling service
// behind both surfaces, per the design doc's "no separate Discord scheduler and web scheduler."
function actorDiscordId(auth: { mode: "bot" } | { mode: "user"; discordId: string }, bodyDiscordId?: string): string {
  if (auth.mode === "user") return auth.discordId;
  if (!bodyDiscordId) throw new ApiError(400, "discordId is required.");
  return bodyDiscordId;
}

export async function schedulingRoutes(app: FastifyInstance) {
  app.post("/v1/scheduling/timezone", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), timezone: z.string().min(1), source: z.enum(["site_detected", "site_manual", "discord_manual"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      return reply.send(await setTimezone({ userId, timezone: body.timezone, source: body.source }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/visibility", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), showDetailed: z.boolean() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      return reply.send(await setAvailabilityVisibility({ userId, showDetailed: body.showDetailed }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/profile", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const profile = await getAvailabilityProfileByDiscordId(body.discordId);
      const userId = await userIdFromDiscordId(body.discordId);
      const context = await getCurrentLeagueContext(body.guildId);
      const windows = await getRecurringWindows(userId, context.leagueId);
      const overrides = await listOverrides({ userId, leagueId: context.leagueId });
      return reply.send({ profile, windows, overrides });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/windows", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), leagueScoped: z.boolean().default(false),
        weekday: z.number().int().min(0).max(6),
        windows: z.array(z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(2880) })),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      const leagueId = body.leagueScoped ? (await getCurrentLeagueContext(body.guildId)).leagueId : null;
      return reply.send(await setRecurringWindowsForDay({ userId, leagueId, weekday: body.weekday, windows: body.windows }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/overrides", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid().optional().nullable(),
        scope: z.enum(["week", "day", "matchup"]), startsAt: z.string(), endsAt: z.string(),
        unavailable: z.boolean(), timezoneOverride: z.string().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      const context = await getCurrentLeagueContext(body.guildId);
      return reply.send(await createOverride({
        userId, leagueId: context.leagueId, gameId: body.gameId ?? null, scope: body.scope,
        startsAt: body.startsAt, endsAt: body.endsAt, unavailable: body.unavailable, timezoneOverride: body.timezoneOverride,
      }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/overrides/delete", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), overrideId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      return reply.send(await deleteOverride({ userId, overrideId: body.overrideId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/suggestions", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await getSchedulingSuggestions(body.gameId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/status", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send({ status: await computeUserFacingStatus(body.gameId) });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/respond", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const discordId = actorDiscordId(auth, body.discordId);
      const userId = await userIdFromDiscordId(discordId);
      return reply.send(await markResponded(body.gameId, userId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/propose", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid(), proposedForUtc: z.string() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await proposeTime({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId), proposedForUtc: body.proposedForUtc }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/respond-to-proposal", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid(), proposalId: z.string().uuid(),
        action: z.enum(["accept", "counter", "withdraw"]), counterForUtc: z.string().optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await respondToProposal({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId), proposalId: body.proposalId, action: body.action, counterForUtc: body.counterForUtc }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/request-reschedule", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await requestReschedule({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/checkin", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await checkIn({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/request-force-win", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await requestForceWin({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/availability", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid(), userId: z.string().uuid(), fromUtc: z.string(), toUtc: z.string() }).parse(request.body);
      const context = await getCurrentLeagueContext(body.guildId);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await getEffectiveAvailability({ userId: body.userId, leagueId: context.leagueId, gameId: body.gameId, fromUtc: body.fromUtc, toUtc: body.toUtc }));
    } catch (error) { return sendError(reply, error); }
  });
}
