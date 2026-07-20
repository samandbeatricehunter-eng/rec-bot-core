import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { listScheduleSeason, listScheduleTeams, listScheduleWeek, previewScheduleImport, replaceScheduleWeek, saveManualScheduleGame, seedDefaultScheduleForGuild } from "./schedule.service.js";
import { commitTeamScheduleDecisions, getTeamScheduleManualState, previewCfbTeamScheduleImport } from "./team-schedule.service.js";
import { getLinkedRoster, getTeamManagementSummary } from "./team-schedule-summary.service.js";
import { computeLeagueSos } from "./sos.service.js";
import { computePowerRankings } from "./power-rankings.service.js";
import { setGameRivalry } from "../rivalries/rivalries.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

const GuildSchema = z.object({ guildId: z.string().min(1) });

// weekNumber floors at 0 (not 1) — CFB's regular season starts at Week 0.
const WeekSchema = z.object({
  guildId: z.string().min(1),
  seasonNumber: z.number().int().positive().optional().nullable(),
  weekNumber: z.number().int().min(0),
});

const SaveManualGameSchema = z.object({
  guildId: z.string().min(1),
  seasonNumber: z.number().int().positive().optional().nullable(),
  weekNumber: z.number().int().min(0),
  slotNumber: z.number().int().positive(),
  awayTeamId: z.string().uuid(),
  homeTeamId: z.string().uuid(),
  requestedByDiscordId: z.string().optional().nullable(),
});

export async function scheduleRoutes(app: FastifyInstance) {
  app.post("/v1/schedule/teams", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "member" });
      const { guildId } = GuildSchema.parse(request.body);
      return reply.send(await listScheduleTeams(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/week", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = WeekSchema.parse(request.body);
      return reply.send(await listScheduleWeek(input.guildId, input.weekNumber, input.seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/season", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await listScheduleSeason(input.guildId, input.seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/sos", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        discordId: z.string().optional().nullable(),
      }).parse(request.body);
      return reply.send(await computeLeagueSos(input.guildId, input.discordId ?? null));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/power-rankings", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        discordId: z.string().optional().nullable(),
        completedWeekNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await computePowerRankings(input.guildId, input.discordId ?? null, { completedWeekNumber: input.completedWeekNumber ?? null }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/manual-game", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await saveManualScheduleGame(SaveManualGameSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/seed-default", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        requestedByDiscordId: z.string().optional().nullable(),
        force: z.boolean().optional(),
      }).parse(request.body);
      return reply.send(await seedDefaultScheduleForGuild(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Parse a League Schedule screenshot into matchups matched to league teams (no DB write).
  app.post("/v1/schedule/import-preview", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        // Allow playoff weeks (19–22), not just the regular season; floors at 0 for CFB's Week 0.
        weekNumber: z.number().int().min(0).max(22),
        imageUrls: z.array(z.string().url()).min(1).max(2),
      }).parse(request.body);
      return reply.send(await previewScheduleImport(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/replace-week", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
        weekNumber: z.number().int().min(0),
        games: z.array(z.object({
          awayTeamId: z.string().uuid(),
          homeTeamId: z.string().uuid(),
        })).min(1),
        requestedByDiscordId: z.string().optional().nullable(),
      }).parse(request.body);
      return reply.send(await replaceScheduleWeek(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Parse a CFB Team Schedule screenshot (one team, every week) into per-week matchups
  // matched against the league's actual teams, flagging weeks already confirmed from
  // this or an earlier team's upload. No DB write.
  app.post("/v1/schedule/cfb-team-import-preview", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = z.object({
        guildId: z.string().min(1),
        teamId: z.string().uuid(),
        seasonNumber: z.number().int().positive().optional().nullable(),
        imageUrls: z.array(z.string().url()).min(1).max(2),
      }).parse(request.body);
      return reply.send(await previewCfbTeamScheduleImport(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Commits the commissioner-approved per-week decisions from the preview above.
  // Weeks already confirmed (by this or an earlier team's upload) are silently skipped.
  // Game-generic (cfb_27 | madden_26 | madden_27).
  app.post("/v1/schedule/team-schedule-commit", async (request, reply) => {
    try {
      const auth = await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const input = z.object({
        guildId: z.string().min(1),
        teamId: z.string().uuid(),
        seasonNumber: z.number().int().positive().optional().nullable(),
        decisions: z.array(z.object({
          weekNumber: z.number().int().min(0),
          opponentTeamId: z.string().uuid(),
          homeAway: z.enum(["home", "away"]),
        })),
        byeWeeks: z.array(z.number().int().min(0)).optional(),
        requestedByDiscordId: z.string().optional().nullable(),
      }).parse(request.body);
      // Attribute Activity-originated saves to the actual Discord user, not a generic bot save.
      if (auth.mode === "user" && !input.requestedByDiscordId) input.requestedByDiscordId = auth.discordId;
      return reply.send(await commitTeamScheduleDecisions(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Activity-only: the no-OCR equivalent of the CFB screenshot import preview — every
  // regular-season week for a team plus its already-confirmed status, for the "fill in the
  // whole season on one page" form (no screenshot involved). Game-generic.
  app.post("/v1/schedule/team-manual-preview", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const input = z.object({
        guildId: z.string().min(1),
        teamId: z.string().uuid(),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await getTeamScheduleManualState(input));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/schedule/game-rivalry", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const input = z.object({
        guildId: z.string().min(1), gameId: z.string().uuid(), enabled: z.boolean(),
        details: z.object({
          rivalryName: z.string().trim().min(1).max(64), firstYearPlayed: z.number().int().min(1869).max(2100).nullable(),
          teamAWins: z.number().int().min(0), teamBWins: z.number().int().min(0), ties: z.number().int().min(0).optional(),
          lastGameTeamAScore: z.number().int().min(0).nullable(), lastGameTeamBScore: z.number().int().min(0).nullable(),
          streakWinnerTeamId: z.string().uuid().nullable(), streakLength: z.number().int().min(0),
        }).optional(),
      }).parse(request.body);
      const context = await getCurrentLeagueContext(input.guildId);
      return reply.send(await setGameRivalry({ leagueId: context.leagueId, gameId: input.gameId, enabled: input.enabled, details: input.details }));
    } catch (error) { return sendError(reply, error); }
  });

  // Manage League hub's list view: every team's ownership + schedule-completion +
  // box-score-health status in one call.
  app.post("/v1/schedule/team-management-summary", async (request, reply) => {
    try {
      await requireBotOrUserSession(request, { resolveGuildId: (r: any) => r.body?.guildId, permission: "co_commissioner" });
      const input = z.object({
        guildId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional().nullable(),
      }).parse(request.body);
      return reply.send(await getTeamManagementSummary(input.guildId, input.seasonNumber));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Home page's linked-users panel — public roster info (who's playing whom, how's their
  // season going), so this is member-permission rather than the co_commissioner-gated
  // summary above.
  app.post("/v1/schedule/linked-roster", async (request, reply) => {
    try {
      const { guildId } = GuildSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await getLinkedRoster(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
