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
  checkIn, getMatchupSchedulingSnapshot, getSchedulingSuggestions, listWeekSchedulingStatuses, markCantMakeGame, markGameStarted, markResponded, proposeTime,
  refreshSchedulingPanelsForUser, requestForceWin, requestReschedule, resetScheduling, resolveCantMakeGame, respondToProposal,
} from "./matchup-scheduling.service.js";
import { userIdFromDiscordId } from "./shared.js";
import { zonedWallTimeToUtcIana } from "../../lib/timezone.js";
import { syncAvailabilityBoard } from "./availability-board.service.js";
import { markGameOver } from "./game-announcement.service.js";

function resyncBoard(guildId: string) {
  syncAvailabilityBoard(guildId).catch((error) => console.error("[ERROR] Failed to resync availability board (non-fatal):", error));
}

function refreshPanels(userId: string) {
  refreshSchedulingPanelsForUser(userId).catch((error) => console.error("[ERROR] Failed to refresh scheduling panels (non-fatal):", error));
}

// Accepts either a raw UTC instant or a local wall-clock time + zone (the Discord custom-time
// modal, which can't do DST-aware conversion client-side) -- same "8pm"/"8:30pm" format as the
// bot's availability-text parser, kept as a tiny local duplicate since that parser lives in the
// bot package and isn't shared cross-package for ~10 lines of regex.
const LOCAL_TIME_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
function resolveProposedForUtc(input: { proposedForUtc?: string; localDate?: string; localTime?: string; timezone?: string }): string {
  if (input.proposedForUtc) return input.proposedForUtc;
  if (!input.localDate || !input.localTime || !input.timezone) throw new ApiError(400, "Provide either proposedForUtc or localDate/localTime/timezone.");
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.localDate.trim());
  if (!dateMatch) throw new ApiError(400, "Date must be YYYY-MM-DD.");
  const timeMatch = LOCAL_TIME_RE.exec(input.localTime.trim());
  if (!timeMatch) throw new ApiError(400, 'Time must look like "8:00 PM".');
  const hour12 = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? "0");
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) throw new ApiError(400, "Invalid time.");
  const meridiem = timeMatch[3]!.toLowerCase();
  const hour24 = meridiem === "am" ? (hour12 === 12 ? 0 : hour12) : (hour12 === 12 ? 12 : hour12 + 12);
  const [, year, month, day] = dateMatch;
  return zonedWallTimeToUtcIana(Number(year), Number(month), Number(day), hour24, minute, input.timezone).toISOString();
}

// Every action here is reachable identically from Discord (bot mode, discordId in the body,
// trusted) and the site (user mode, session-resolved discordId) -- one scheduling service
// behind both surfaces, per the design doc's "no separate Discord scheduler and web scheduler."
function actorDiscordId(auth: { mode: "bot" } | { mode: "user"; discordId: string }, bodyDiscordId?: string): string {
  if (auth.mode === "user") return auth.discordId;
  if (!bodyDiscordId) throw new ApiError(400, "discordId is required.");
  return bodyDiscordId;
}

// Overrides can arrive as explicit UTC startsAt/endsAt, or as a local calendar date + timezone
// (the Discord "This Week" flow) with an optional startMinute/endMinute window -- omitted means
// the whole local day (00:00-24:00), used for a plain "unavailable this day" entry.
function resolveOverrideRange(input: { startsAt?: string; endsAt?: string; localDate?: string; timezone?: string; startMinute?: number; endMinute?: number }): [string, string] {
  if (input.startsAt && input.endsAt) return [input.startsAt, input.endsAt];
  if (!input.localDate || !input.timezone) throw new ApiError(400, "Provide either startsAt/endsAt or localDate/timezone.");
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.localDate.trim());
  if (!dateMatch) throw new ApiError(400, "Date must be YYYY-MM-DD.");
  const [, year, month, day] = dateMatch;
  const startMinute = input.startMinute ?? 0;
  const endMinute = input.endMinute ?? 1440;
  const start = zonedWallTimeToUtcIana(Number(year), Number(month), Number(day), Math.floor(startMinute / 60), startMinute % 60, input.timezone);
  const end = new Date(start.getTime() + (endMinute - startMinute) * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

export async function schedulingRoutes(app: FastifyInstance) {
  app.post("/v1/scheduling/timezone", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), timezone: z.string().min(1), source: z.enum(["site_detected", "site_manual", "discord_manual"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      const result = await setTimezone({ userId, timezone: body.timezone, source: body.source });
      resyncBoard(body.guildId);
      refreshPanels(userId);
      return reply.send(result);
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
      const result = await setRecurringWindowsForDay({ userId, leagueId, weekday: body.weekday, windows: body.windows });
      resyncBoard(body.guildId);
      refreshPanels(userId);
      return reply.send(result);
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/overrides", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid().optional().nullable(),
        scope: z.enum(["week", "day", "matchup"]), startsAt: z.string().optional(), endsAt: z.string().optional(),
        localDate: z.string().optional(), timezone: z.string().optional(), startMinute: z.number().int().min(0).max(1439).optional(), endMinute: z.number().int().min(1).max(1440).optional(),
        unavailable: z.boolean(), timezoneOverride: z.string().optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const userId = await userIdFromDiscordId(actorDiscordId(auth, body.discordId));
      const context = await getCurrentLeagueContext(body.guildId);
      const [startsAt, endsAt] = resolveOverrideRange(body);
      const result = await createOverride({
        userId, leagueId: context.leagueId, gameId: body.gameId ?? null, scope: body.scope,
        startsAt, endsAt, unavailable: body.unavailable, timezoneOverride: body.timezoneOverride,
      });
      refreshPanels(userId);
      return reply.send(result);
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
      const body = z.object({ guildId: z.string().min(1), gameId: z.string().uuid(), discordId: z.string().optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const discordId = auth.mode === "user" ? auth.discordId : body.discordId;
      const viewerUserId = discordId ? await userIdFromDiscordId(discordId).catch(() => null) : null;
      return reply.send(await getMatchupSchedulingSnapshot(body.gameId, viewerUserId));
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
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid(),
        proposedForUtc: z.string().optional(), localDate: z.string().optional(), localTime: z.string().optional(), timezone: z.string().optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const proposedForUtc = resolveProposedForUtc(body);
      return reply.send(await proposeTime({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId), proposedForUtc }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/respond-to-proposal", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid(), proposalId: z.string().uuid(),
        action: z.enum(["accept", "counter", "withdraw", "reject"]),
        counterForUtc: z.string().optional(), localDate: z.string().optional(), localTime: z.string().optional(), timezone: z.string().optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const counterForUtc = body.action === "counter" ? resolveProposedForUtc({ proposedForUtc: body.counterForUtc, localDate: body.localDate, localTime: body.localTime, timezone: body.timezone }) : undefined;
      return reply.send(await respondToProposal({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId), proposalId: body.proposalId, action: body.action, counterForUtc }));
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

  app.post("/v1/scheduling/matchup/game-started", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await markGameStarted({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/request-force-win", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await requestForceWin({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/cant-make-game", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await markCantMakeGame({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/cant-make-game-response", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid(), choice: z.enum(["accept_fs", "request_autopilot"]) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await resolveCantMakeGame({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId), choice: body.choice }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/reset", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await resetScheduling({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId) }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/week-status", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listWeekSchedulingStatuses(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/scheduling/matchup/game-over", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1), discordId: z.string().optional(), gameId: z.string().uuid(),
        homeScore: z.number().int().min(0).optional().nullable(), awayScore: z.number().int().min(0).optional().nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      return reply.send(await markGameOver({ gameId: body.gameId, discordId: actorDiscordId(auth, body.discordId), homeScore: body.homeScore, awayScore: body.awayScore }));
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
