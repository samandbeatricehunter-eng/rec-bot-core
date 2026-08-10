import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { getGameChannelMatchup, getGameChannelMatchupsForGuild } from "./game-channel-matchup.service.js";
import { createGameChannelsForCurrentWeek, listCurrentWeekGameChannelCandidates, listTrackedGameChannelDiscordIds, markTrackedGameChannelsDeleted, recreateGameChannelsForGames, registerGameChannel, repairGameChannelsForCurrentWeek } from "./game-channels.service.js";

export async function gameChannelRoutes(app: FastifyInstance) {
  // Commissioner-facing "Create Game Channels" action from League Mgmt.
  app.post("/v1/game-channels/create-current-week", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await createGameChannelsForCurrentWeek(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Fill-only repair: creates a channel only for a current-week H2H matchup that doesn't
  // have one yet — never deletes or recreates an existing tracked channel.
  app.post("/v1/game-channels/repair-current-week", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await repairGameChannelsForCurrentWeek(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Repair picker: current-week H2H matchups + whether each already has an active channel,
  // so the commissioner can choose specific ones to wipe+recreate.
  app.post("/v1/game-channels/current-week-candidates", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await listCurrentWeekGameChannelCandidates(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Wipes+recreates only the selected current-week matchups — leaves every other tracked
  // channel untouched.
  app.post("/v1/game-channels/recreate-selected", async (request, reply) => {
    try {
      const { guildId, gameIds } = z.object({ guildId: z.string().min(1), gameIds: z.array(z.string().min(1)).min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      return reply.send(await recreateGameChannelsForGames(guildId, gameIds));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/matchup", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId, discordChannelId } = z.object({
        guildId: z.string().min(1),
        discordChannelId: z.string().min(1),
      }).parse(request.body);
      return reply.send(await getGameChannelMatchup(guildId, discordChannelId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/matchups", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await getGameChannelMatchupsForGuild(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/tracked", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send({ discordChannelIds: await listTrackedGameChannelDiscordIds(guildId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/register", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        gameId: z.string().uuid().optional().nullable(),
        discordChannelId: z.string().min(1),
        seasonNumber: z.number().int().positive(),
        // CFB regular season starts at Week 0.
        weekNumber: z.number().int().min(0),
        awayTeamId: z.string().uuid().optional().nullable(),
        homeTeamId: z.string().uuid().optional().nullable(),
        awayUserId: z.string().uuid().optional().nullable(),
        homeUserId: z.string().uuid().optional().nullable(),
      }).parse(request.body);
      return reply.send({ gameChannel: await registerGameChannel(input) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/game-channels/mark-deleted", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { discordChannelIds } = z.object({
        discordChannelIds: z.array(z.string().min(1)),
      }).parse(request.body);
      return reply.send(await markTrackedGameChannelsDeleted(discordChannelIds));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
