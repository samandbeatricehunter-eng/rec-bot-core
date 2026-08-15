import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import {
  beginEaLogin,
  bindEaLeague,
  disconnectEaConnection,
  getEaConnectionStatus,
  importEaDatasets,
  importEaDatasetsWithProgress,
  listEaImportJobs,
  listEaLeagues,
  selectEaPersona,
  submitEaCode,
  updateEaConnectionSettings,
  wipeBaselineRoster,
  reconcilePendingPurchasesToImport,
  type EaDataset,
  type EaImportProgressEvent,
} from "./ea-connections.service.js";
import { EA_DATASETS } from "./ea-datasets.js";
import { validateWeekRef } from "./ea-weeks.js";

const datasetSchema = z.enum(EA_DATASETS as [EaDataset, ...EaDataset[]]);

async function requireLeagueCommissioner(request: FastifyRequest, guildId: string, leagueId: string) {
  const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "commissioner" });
  if (auth.mode === "bot") throw new ApiError(403, "Browser session required.");
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== leagueId) throw new ApiError(403, "League does not belong to this server context.");
  return auth;
}

export async function maddenEaRoutes(app: FastifyInstance) {
  // Whether the server is configured to offer direct EA linking at all.
  app.get("/v1/import/madden/ea/health", async (_request, reply) => {
    try {
      const { isEaImportConfigured } = await import("./ea-constants.js");
      return reply.send({ ok: true, configured: isEaImportConfigured(), datasets: EA_DATASETS });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Step 1 of the link flow: returns the EA login URL the commissioner opens in a browser.
  app.post("/v1/import/madden/ea/login", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await beginEaLogin(body.league_id, auth.discordId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Step 2: exchange the pasted redirect URL/code for the temporary token and list personas.
  app.post("/v1/import/madden/ea/code", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), pasted: z.string().min(8).max(2000) }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await submitEaCode(body.league_id, auth.discordId, body.pasted));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Step 3: pick a gamertag; the persona-scoped token is sealed and persisted.
  app.post("/v1/import/madden/ea/persona", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(),
        pending_auth_id: z.string().uuid(), persona_id: z.number().int().positive(),
      }).parse(request.body);
      const auth = await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connection: await selectEaPersona(body.league_id, auth.discordId, body.pending_auth_id, body.persona_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/status", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await getEaConnectionStatus(body.league_id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // List the EA franchises the bound persona owns, so the commissioner can pick the one that
  // maps to this REC league.
  app.post("/v1/import/madden/ea/leagues", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ leagues: await listEaLeagues(body.connection_id, body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/bind", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(), ea_league_id: z.number().int().positive() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connection: await bindEaLeague(body.connection_id, body.league_id, body.ea_league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/settings", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(),
        datasets: z.array(datasetSchema).min(1).optional(), auto_import: z.boolean().optional(),
      }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ connection: await updateEaConnectionSettings(body.connection_id, body.league_id, body.datasets, body.auto_import) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Pull the enabled datasets from EA and run them through the ingest pipeline. Weekly
  // datasets default to the franchise's current week; pass week_refs to import a specific
  // week or a span (each entry validated; snapshots import once regardless).
  app.post("/v1/import/madden/ea/import", async (request, reply) => {
    try {
      const body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(),
        datasets: z.array(datasetSchema).min(1).optional(),
        stage: z.union([z.literal(0), z.literal(1)]).optional(),
        week_index: z.number().int().min(0).max(22).optional(),
        week_refs: z.array(z.object({ stage: z.union([z.literal(0), z.literal(1)]), week_index: z.number().int().min(0).max(22) })).min(1).max(27).optional(),
      }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      if (body.stage !== undefined && body.week_index !== undefined) validateWeekRef({ stageIndex: body.stage, weekIndex: body.week_index });
      const weekRefs = body.week_refs?.map((ref) => validateWeekRef({ stageIndex: ref.stage, weekIndex: ref.week_index }));
      return reply.send({ imports: await importEaDatasets(body.connection_id, body.league_id, { datasets: body.datasets, stage: body.stage, weekIndex: body.week_index, weekRefs }) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // SSE streaming variant of the import endpoint — emits real-time progress events
  // as each dataset starts, completes, or fails. The frontend connects via fetch()
  // with response.body.getReader() since EventSource only supports GET.
  app.post("/v1/import/madden/ea/import-stream", async (request, reply) => {
    let body: { guild_id: string; league_id: string; connection_id: string; datasets?: EaDataset[]; stage?: 0 | 1; week_index?: number; week_refs?: Array<{ stage: 0 | 1; week_index: number }> };
    try {
      body = z.object({
        guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(),
        datasets: z.array(datasetSchema).min(1).optional(),
        stage: z.union([z.literal(0), z.literal(1)]).optional(),
        week_index: z.number().int().min(0).max(22).optional(),
        week_refs: z.array(z.object({ stage: z.union([z.literal(0), z.literal(1)]), week_index: z.number().int().min(0).max(22) })).min(1).max(27).optional(),
      }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
    } catch (error) {
      return sendError(reply, error);
    }

    // Hijack the reply so Fastify doesn't buffer our SSE stream
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    function sendEvent(event: EaImportProgressEvent) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    try {
      if (body.stage !== undefined && body.week_index !== undefined) validateWeekRef({ stageIndex: body.stage, weekIndex: body.week_index });
      const weekRefs = body.week_refs?.map((ref) => validateWeekRef({ stageIndex: ref.stage, weekIndex: ref.week_index }));
      await importEaDatasetsWithProgress(body.connection_id, body.league_id, { datasets: body.datasets, stage: body.stage, weekIndex: body.week_index, weekRefs }, sendEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendEvent({ type: "error", error: message });
    } finally {
      reply.raw.end();
    }
  });

  app.post("/v1/import/madden/ea/jobs", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send({ jobs: await listEaImportJobs(body.league_id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/import/madden/ea/disconnect", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      await disconnectEaConnection(body.connection_id, body.league_id);
      return reply.send({ ok: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Retroactive wipe: clears all baseline/seeded players for a league so the next EA
  // import becomes the sole source of truth. Custom player builds are preserved.
  app.post("/v1/import/madden/ea/wipe-roster", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const wiped = await wipeBaselineRoster(body.league_id);
      return reply.send({ ok: true, wiped });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Backfill: sync existing imported scores from rec_games into rec_game_results
  // so advance readiness picks them up without re-importing. Returns diagnostic counts.
  app.post("/v1/import/madden/ea/backfill-scores", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const { getPgPool } = await import("../../db/client.js");
      const pool = getPgPool();

      // Diagnostic: count games at each filter stage
      const counts = await pool.query(
        `select
           count(*) filter (where source='madden_companion_export') as companion_games,
           count(*) filter (where source='madden_companion_export' and status='completed') as completed,
           count(*) filter (where source='madden_companion_export' and status='completed' and home_score is not null) as with_scores,
           count(*) filter (where source='madden_companion_export' and status='completed' and home_score is not null and home_team_id is not null) as ready,
           count(*) filter (where source='madden_companion_export' and status='scheduled') as scheduled,
           count(*) filter (where home_score is not null and home_score > 0) as any_with_scores,
           count(*) as total_games
         from rec_games where league_id=$1`,
        [body.league_id],
      );

      // Sample some games to see what source/status they have
      const sample = await pool.query(
        `select id, source, status, home_score, away_score, home_team_id, away_team_id, external_game_id
         from rec_games where league_id=$1 order by updated_at desc limit 5`,
        [body.league_id],
      );

      // Run the sync
      const { syncCompanionScheduleResultsIntoGameResults } = await import("../madden-companion/madden-companion.service.js");
      await syncCompanionScheduleResultsIntoGameResults(body.league_id);

      // Check results after sync
      const resultsCount = await pool.query(
        `select count(*) as total, count(*) filter (where source='madden_companion_import') as companion_import
         from rec_game_results where league_id=$1`,
        [body.league_id],
      );

      return reply.send({ ok: true, games: counts.rows[0], results: resultsCount.rows[0], sampleGames: sample.rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
