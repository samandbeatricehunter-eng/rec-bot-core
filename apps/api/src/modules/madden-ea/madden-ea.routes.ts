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
  getImportProgress,
  beginImportProgress,
  pushProgress,
  listEaImportJobs,
  listEaLeagues,
  recordEaImportError,
  selectEaPersona,
  submitEaCode,
  updateEaConnectionSettings,
  wipeBaselineRoster,
  type EaDataset,
} from "./ea-connections.service.js";
import { auditEaImportData } from "./import-audit.service.js";
import { EA_DATASETS } from "./ea-datasets.js";
import { validateWeekRef, type EaWeekScope } from "./ea-weeks.js";

const datasetSchema = z.enum(EA_DATASETS as [EaDataset, ...EaDataset[]]);

async function requireLeagueCommissioner(request: FastifyRequest, guildId: string, leagueId: string) {
  // "co_commissioner" qualifies both head commissioners and co-commissioners -- import data
  // shouldn't require the head commissioner specifically.
  const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
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

  const importBodySchema = z.object({
    guild_id: z.string().min(1), league_id: z.string().uuid(), connection_id: z.string().uuid(),
    datasets: z.array(datasetSchema).min(1).optional(),
    stage: z.union([z.literal(0), z.literal(1)]).optional(),
    week_index: z.number().int().min(0).max(22).optional(),
    week_refs: z.array(z.object({ stage: z.union([z.literal(0), z.literal(1)]), week_index: z.number().int().min(0).max(22) })).min(1).max(27).optional(),
    week_scope: z.enum(["current", "through_current"]).optional(),
  });

  function weekOptionsFromBody(body: z.infer<typeof importBodySchema>) {
    if (body.stage !== undefined && body.week_index !== undefined) validateWeekRef({ stageIndex: body.stage, weekIndex: body.week_index });
    const weekRefs = body.week_refs?.map((ref) => validateWeekRef({ stageIndex: ref.stage, weekIndex: ref.week_index }));
    return { datasets: body.datasets, stage: body.stage, weekIndex: body.week_index, weekRefs, weekScope: body.week_scope as EaWeekScope | undefined };
  }

  // Pull the enabled datasets from EA and run them through the ingest pipeline. Weekly
  // datasets default to the franchise's current week; pass week_refs for a specific week or
  // span, or week_scope=through_current for every week up through current (snapshots once).
  app.post("/v1/import/madden/ea/import", async (request, reply) => {
    try {
      const body = importBodySchema.parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const options = weekOptionsFromBody(body);
      try {
        const imports = await importEaDatasets(body.connection_id, body.league_id, options);
        const { refreshImmortalityProspectCardsForLeague, resolvePendingMediaDayClaimsForLeague } = await import("../immortality/immortality.service.js");
        await refreshImmortalityProspectCardsForLeague(body.league_id).catch((err) => console.error(`[ERROR] RTI prospect card refresh failed for league ${body.league_id} (non-fatal):`, err));
        await resolvePendingMediaDayClaimsForLeague(body.league_id).catch((err) => console.error(`[ERROR] RTI Media Day claim resolution failed for league ${body.league_id} (non-fatal):`, err));
        const { postRosterMovementForLeague } = await import("../immortality/roster-movement.service.js");
        await postRosterMovementForLeague(body.league_id).catch((err) => console.error(`[ERROR] RTI roster movement post failed for league ${body.league_id} (non-fatal):`, err));
        const { checkNflRecordsAfterImport } = await import("../immortality/nfl-record-holders.service.js");
        await checkNflRecordsAfterImport(body.league_id).catch((err) => console.error(`[ERROR] RTI NFL record check failed for league ${body.league_id} (non-fatal):`, err));
        return reply.send({ imports });
      } catch (importError) {
        await recordEaImportError(body.connection_id, importError);
        throw importError;
      }
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Start an import — runs in background, progress polled via /import-progress.
  app.post("/v1/import/madden/ea/import-async", async (request, reply) => {
    try {
      const body = importBodySchema.parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      const options = weekOptionsFromBody(body);

      // The in-memory progress store used to get wiped unconditionally here, so two calls in
      // close succession (a stuck request retried by the client, two open tabs, or the modal
      // reopening after being closed mid-import — see ImportDataModal.tsx) could both pass
      // this point and run importEaDatasetsWithProgress concurrently against the same league.
      // A running import for this league blocks a new one instead.
      const inFlight = getImportProgress(body.league_id);
      if (inFlight.running) {
        const runningWeek = inFlight.weekLabel ? ` for ${inFlight.weekLabel}` : "";
        throw new ApiError(409, `An import is already running${runningWeek} for this league. Wait for it to finish, or reopen Import Data to watch its progress.`);
      }
      beginImportProgress(body.league_id, "manual");

      // Fire and forget — the import runs in the background
      importEaDatasetsWithProgress(body.connection_id, body.league_id, options).then(async () => {
        const { refreshImmortalityProspectCardsForLeague, resolvePendingMediaDayClaimsForLeague } = await import("../immortality/immortality.service.js");
        await refreshImmortalityProspectCardsForLeague(body.league_id).catch((err) => console.error(`[ERROR] RTI prospect card refresh failed for league ${body.league_id} (non-fatal):`, err));
        await resolvePendingMediaDayClaimsForLeague(body.league_id).catch((err) => console.error(`[ERROR] RTI Media Day claim resolution failed for league ${body.league_id} (non-fatal):`, err));
        const { postRosterMovementForLeague } = await import("../immortality/roster-movement.service.js");
        await postRosterMovementForLeague(body.league_id).catch((err) => console.error(`[ERROR] RTI roster movement post failed for league ${body.league_id} (non-fatal):`, err));
        const { checkNflRecordsAfterImport } = await import("../immortality/nfl-record-holders.service.js");
        await checkNflRecordsAfterImport(body.league_id).catch((err) => console.error(`[ERROR] RTI NFL record check failed for league ${body.league_id} (non-fatal):`, err));
      }).catch((error) => {
        console.error("[EA] Background import failed:", error);
        pushProgress(body.league_id, { type: "error", error: error instanceof Error ? error.message : String(error) });
        void recordEaImportError(body.connection_id, error);
      });

      return reply.send({ ok: true, message: "Import started. Poll /v1/import/madden/ea/import-progress for status." });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Poll import progress — returns all events since the import started.
  app.post("/v1/import/madden/ea/import-progress", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(getImportProgress(body.league_id));
    } catch (error) {
      return sendError(reply, error);
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

  app.post("/v1/import/madden/ea/audit", async (request, reply) => {
    try {
      const body = z.object({ guild_id: z.string().min(1), league_id: z.string().uuid() }).parse(request.body);
      await requireLeagueCommissioner(request, body.guild_id, body.league_id);
      return reply.send(await auditEaImportData(body.guild_id, body.league_id));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
