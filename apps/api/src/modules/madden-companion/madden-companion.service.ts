import crypto from "node:crypto";
import { getPgPool } from "../../db/client.js";
import { bestEffort } from "../../lib/best-effort.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { ApiError } from "../../lib/errors.js";
import { isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { finalizeImportedLeagueStats } from "../league-records/league-records.service.js";
import { importedStatsNeedFinalize } from "../league-records/league-records.finalize.js";
import { companionChecksum, normalizeCompanionPayload, splitCompanionPayload } from "./madden-companion.adapters.js";
import { applyCompanionRecordToCanonical } from "./madden-companion.canonical.js";
import { gameResultsApplyKey, rebuildOfficialRecordsAfterBoxScore } from "../official-records/official-records.service.js";

export type MaddenEndpointKey =
  | "league_metadata"
  | "teams"
  | "standings"
  | "schedule"
  | "rosters"
  | "player_stats"
  | "team_stats";

export const MADDEN_ENDPOINT_KEYS: MaddenEndpointKey[] = [
  "league_metadata", "teams", "standings", "schedule", "rosters", "player_stats", "team_stats",
];

export type CompanionConnection = {
  id: string;
  league_id: string;
  endpoint_slug: string;
  external_league_id: string | null;
  config: {
    endpoint_keys: MaddenEndpointKey[];
    rate_limit_per_minute: number;
    max_payload_bytes: number;
  };
  status: "active" | "disabled" | "error";
  last_health_check_at: string | null;
  last_health_status: string | null;
  created_at: string;
  updated_at: string;
};

export type IngestResult = {
  accepted: true;
  import_job_id: string;
  duplicate: boolean;
  records_stored: number;
  records_applied: number;
};

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function createToken() {
  const slug = crypto.randomBytes(8).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return { slug, token: `${slug}.${secret}` };
}

export async function validateCompanionConnection(connectionToken: string, endpointKey?: MaddenEndpointKey): Promise<CompanionConnection | null> {
  const result = await getPgPool().query<CompanionConnection>(
    `select id, league_id, endpoint_slug, external_league_id, config, status,
            last_health_check_at, last_health_status, created_at, updated_at
       from rec_import_connections
      where connection_type='madden_companion' and token_hash=$1 and status='active'
      limit 1`,
    [tokenHash(connectionToken)],
  );
  const connection = result.rows[0] ?? null;
  if (!connection) return null;
  if (endpointKey && !(connection.config.endpoint_keys ?? []).includes(endpointKey)) return null;
  return connection;
}

/** Import provenance. REC's direct EA client reuses this whole pipeline but is recorded
 *  separately so audit/rollback can tell a push from the app apart from a pull from EA. */
export type ImportSourceType = "madden_companion" | "madden_direct_sync";

export async function ingestCompanionPayload(connection: CompanionConnection, endpointKey: MaddenEndpointKey, payload: unknown, requestHeaders: Record<string, string>, sourceType: ImportSourceType = "madden_companion"): Promise<IngestResult> {
  const payloadChecksum = companionChecksum(payload);
  const payloadString = JSON.stringify(payload);
  const records = normalizeCompanionPayload(endpointKey, payload);
  if (records.length > 100_000) throw new ApiError(413, "This Companion export contains too many records.");

  const externalIds = [...new Set(records.map((record) => record.externalLeagueId).filter((value): value is string => Boolean(value)))];
  if (externalIds.length > 1) throw new ApiError(422, "The export contains records from more than one EA league.");
  if (connection.external_league_id && externalIds[0] && connection.external_league_id !== externalIds[0]) {
    throw new ApiError(409, "This import URL is already bound to a different EA franchise.");
  }

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`madden-companion:${connection.id}`]);

    const rate = await client.query<{ count: number }>(
      `select count(*)::int as count from rec_import_jobs
        where connection_id=$1 and source_type=$2 and created_at >= now() - interval '1 minute'`,
      [connection.id, sourceType],
    );
    if ((rate.rows[0]?.count ?? 0) >= (connection.config.rate_limit_per_minute ?? 60)) {
      throw new ApiError(429, "Companion import rate limit exceeded; retry in one minute.");
    }

    const duplicate = await client.query<{ id: string; record_count: number }>(
      `select id, record_count from rec_import_jobs
        where league_id=$1 and connection_id=$2 and task_key=$3 and source_checksum=$4
          and source_type=$5 and duplicate_of_job_id is null
        limit 1`,
      [connection.league_id, connection.id, endpointKey, payloadChecksum, sourceType],
    );
    if (duplicate.rows[0]) {
      await client.query(
        `update rec_import_connections set last_health_check_at=now(), last_health_status='duplicate_ignored', updated_at=now() where id=$1`,
        [connection.id],
      );
      await client.query("commit");
      return { accepted: true, import_job_id: duplicate.rows[0].id, duplicate: true, records_stored: duplicate.rows[0].record_count, records_applied: 0 };
    }

    const fallbackSeason = await client.query<{ season_number: number }>("select season_number from rec_leagues where id=$1", [connection.league_id]);
    if (!fallbackSeason.rows[0]) throw new ApiError(404, "REC league not found.");
    const externalSeasonKey = records.find((record) => record.externalSeasonKey !== "current")?.externalSeasonKey
      ?? String(fallbackSeason.rows[0].season_number);

    const job = await client.query<{ id: string }>(
      `insert into rec_import_jobs
         (league_id, connection_id, source_type, task_key, status, started_at, source_checksum, external_season_key, record_count)
       values ($1,$2,$7,$3,'processing',now(),$4,$5,$6)
       returning id`,
      [connection.league_id, connection.id, endpointKey, payloadChecksum, externalSeasonKey, records.length, sourceType],
    );
    const jobId = job.rows[0].id;

    await client.query(
      `insert into rec_import_files(import_job_id, storage_key, mime_type, size_bytes, checksum)
       values ($1,$2,'application/json',$3,$4)`,
      [jobId, `companion/${connection.league_id}/${endpointKey}/${jobId}.json`, Buffer.byteLength(payloadString), payloadChecksum],
    );
    await client.query(
      `insert into rec_import_payloads(import_job_id, payload, adapter_key, adapter_version, checksum)
       values ($1,$2::jsonb,$3,'2.0.0',$4)`,
      [jobId, payloadString, `madden_companion_${endpointKey}`, payloadChecksum],
    );

    // Each record used to cost 4 sequential round trips (record upsert, version insert,
    // canonical apply, import_records insert) while an advisory lock + this whole transaction
    // sat open — on a large export that's a long-held lock blocking any other import for this
    // connection. The record/version/import_records writes are independent of each other except
    // that the version and import_records inserts just need the (possibly upserted) record id,
    // so they're combined into one round trip via chained writable CTEs; only the canonical
    // apply (which has its own per-record logic in madden-companion.canonical.ts) stays separate.
    //
    // After the first import, the same EA row almost always comes back byte-identical.
    // Compare against the latest prior version checksum (not "this hash ever existed") so a
    // later revert still re-applies. Unchanged rows skip the expensive canonical rewrite
    // (roster/stats delete+insert). Last_seen_at still updates via the record upsert.
    let recordsApplied = 0;
    for (const record of records) {
      const seasonKey = record.externalSeasonKey === "current" ? externalSeasonKey : record.externalSeasonKey;
      const normalizedJson = JSON.stringify(record.normalizedData);
      const rawJson = JSON.stringify(record.rawData);
      const stored = await client.query<{ id: string; checksum_is_new: boolean }>(
        `with ins as (
           insert into rec_madden_companion_records
             (league_id, connection_id, external_league_id, external_season_key, endpoint_key, record_key,
              source_team_id, source_player_id, source_game_id, week_number, stat_category,
              normalized_data, raw_data, first_import_job_id, last_import_job_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$14)
           on conflict (league_id, external_season_key, endpoint_key, record_key) do update set
             connection_id=excluded.connection_id,
             external_league_id=coalesce(excluded.external_league_id, rec_madden_companion_records.external_league_id),
             source_team_id=excluded.source_team_id, source_player_id=excluded.source_player_id,
             source_game_id=excluded.source_game_id, week_number=excluded.week_number,
             stat_category=excluded.stat_category, normalized_data=excluded.normalized_data,
             raw_data=excluded.raw_data, last_import_job_id=excluded.last_import_job_id,
             last_seen_at=now(), updated_at=now()
           returning id
         ), ver as (
           insert into rec_madden_companion_record_versions(record_id, import_job_id, content_checksum, normalized_data, raw_data)
           select ins.id, $14, $15, $12::jsonb, $13::jsonb from ins
           on conflict (record_id, content_checksum) do nothing
           returning record_id
         ), rec as (
           insert into rec_import_records(import_job_id, league_id, record_type, entity_key, status, trust_level, applied_at)
           select $14, $1, $5, $16, 'applied', 'trusted_automated_import', now() from ins
         )
         select ins.id,
                coalesce((
                  select v.content_checksum
                    from rec_madden_companion_record_versions v
                   where v.record_id = ins.id
                     and v.import_job_id is distinct from $14
                   order by v.created_at desc
                   limit 1
                ), '') is distinct from $15 as checksum_is_new
           from ins`,
        [connection.league_id, connection.id, record.externalLeagueId, seasonKey, endpointKey, record.recordKey,
          record.sourceTeamId, record.sourcePlayerId, record.sourceGameId, record.weekNumber, record.statCategory,
          normalizedJson, rawJson, jobId, record.contentChecksum, `${seasonKey}:${record.recordKey}`],
      );
      if (stored.rows[0].checksum_is_new) {
        await applyCompanionRecordToCanonical({ client, leagueId: connection.league_id, endpointKey, canonicalRecordId: stored.rows[0].id, seasonKey, record });
        recordsApplied += 1;
      }
    }

    const safeHeaders = Object.fromEntries(Object.entries(requestHeaders).filter(([key]) => !/authorization|cookie|token/i.test(key)));
    await client.query(
      `insert into rec_import_audit_log(import_job_id, event_type, details)
       values ($1,'companion_import_applied',$2::jsonb)`,
      [jobId, JSON.stringify({ endpoint_key: endpointKey, connection_id: connection.id, checksum: payloadChecksum, record_count: records.length, request_headers: safeHeaders })],
    );
    await client.query(
      `update rec_import_jobs set status='completed', completed_at=now(), record_count=$2 where id=$1`,
      [jobId, records.length],
    );
    await client.query(
      `update rec_import_connections set external_league_id=coalesce(external_league_id,$2),
         last_health_check_at=now(), last_health_status=$3, updated_at=now() where id=$1`,
      [connection.id, externalIds[0] ?? null, `ok:${endpointKey}:${records.length}`],
    );
    await client.query("commit");
    return { accepted: true, import_job_id: jobId, duplicate: false, records_stored: records.length, records_applied: recordsApplied };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function ingestCompanionBundle(connection: CompanionConnection, payload: unknown, requestHeaders: Record<string, string>) {
  const datasets = splitCompanionPayload(payload).filter(({ endpointKey }) => connection.config.endpoint_keys.includes(endpointKey));
  if (datasets.length === 0) throw new ApiError(422, "This export did not contain an enabled Companion dataset.");
  const imports: Array<IngestResult & { endpoint_key: MaddenEndpointKey }> = [];
  for (const dataset of datasets) {
    const result = await ingestCompanionPayload(connection, dataset.endpointKey, dataset.payload, requestHeaders);
    imports.push({ endpoint_key: dataset.endpointKey, ...result });
  }
  if (imports.some((item) => item.endpoint_key === "schedule")) {
    await syncCompanionScheduleResultsIntoGameResults(connection.league_id).catch((error) =>
      console.error("[WARN] Failed to sync Companion schedule results into rec_game_results (non-fatal):", error));
  }
  if (importedStatsNeedFinalize(imports.map((item) => item.endpoint_key))
    && imports.some((item) => !item.duplicate && item.records_applied > 0)) {
    await finalizeImportedLeagueStats(connection.league_id).catch((error) =>
      console.error("[WARN] Failed to refresh league records and hub ranks after Companion import (non-fatal):", error));
  }
  return {
    accepted: true as const,
    imports,
    datasets_received: imports.length,
    records_stored: imports.reduce((total, item) => total + item.records_stored, 0),
  };
}

export async function recUserIdFromDiscordId(discordId: string): Promise<string> {
  if (isSiteOnlyDiscordId(discordId)) return recUserIdFromSiteOnlyDiscordId(discordId);
  const result = await getPgPool().query<{ user_id: string }>("select user_id from rec_discord_accounts where discord_id=$1 limit 1", [discordId]);
  if (!result.rows[0]) throw new ApiError(403, "A linked REC account is required.");
  return result.rows[0].user_id;
}

export async function registerCompanionConnection(leagueId: string, requestedByDiscordId: string, endpointKeys: MaddenEndpointKey[] = MADDEN_ENDPOINT_KEYS, rateLimitPerMinute = 60, maxPayloadBytes = 10 * 1024 * 1024) {
  const league = await getPgPool().query<{ game: string }>("select game from rec_leagues where id=$1", [leagueId]);
  if (!league.rows[0]) throw new ApiError(404, "League not found.");
  if (!String(league.rows[0].game).startsWith("madden_")) throw new ApiError(422, "Madden Companion imports are only available for Madden leagues.");
  const userId = await recUserIdFromDiscordId(requestedByDiscordId);
  const generated = createToken();
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`madden-companion-register:${leagueId}`]);
    await client.query(
      `update rec_import_connections set status='disabled', updated_at=now()
        where league_id=$1 and connection_type='madden_companion' and status='active'`,
      [leagueId],
    );
    const result = await client.query<CompanionConnection>(
      `insert into rec_import_connections
         (league_id, connection_type, status, config, created_by_user_id, endpoint_slug, token_hash, token_rotated_at)
       values ($1,'madden_companion','active',$2::jsonb,$3,$4,$5,now()) returning *`,
      [leagueId, JSON.stringify({ endpoint_keys: endpointKeys, rate_limit_per_minute: rateLimitPerMinute, max_payload_bytes: maxPayloadBytes }), userId, generated.slug, tokenHash(generated.token)],
    );
    await client.query("commit");
    return { connectionToken: generated.token, connection: result.rows[0] };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateCompanionToken(connectionId: string, leagueId: string) {
  const generated = createToken();
  const result = await getPgPool().query(
    `update rec_import_connections set endpoint_slug=$3, token_hash=$4, token_rotated_at=now(),
       external_league_id=null, status='active', updated_at=now()
      where id=$1 and league_id=$2 and connection_type='madden_companion' returning id`,
    [connectionId, leagueId, generated.slug, tokenHash(generated.token)],
  );
  if (!result.rows[0]) throw new ApiError(404, "Companion connection not found.");
  return { connectionToken: generated.token };
}

export async function getCompanionConnectionStatus(leagueId: string) {
  const result = await getPgPool().query<CompanionConnection & { import_count: number; last_import_at: string | null }>(
    `select c.id,c.league_id,c.endpoint_slug,c.external_league_id,c.config,c.status,
            c.last_health_check_at,c.last_health_status,c.created_at,c.updated_at,
            count(j.id)::int as import_count,max(j.completed_at) as last_import_at
       from rec_import_connections c left join rec_import_jobs j on j.connection_id=c.id and j.status='completed'
      where c.league_id=$1 and c.connection_type='madden_companion'
      group by c.id order by c.created_at desc`,
    [leagueId],
  );
  return result.rows;
}

// Companion's schedule import writes home_score/away_score straight onto rec_games, but
// Advance Readiness gates on rec_game_results (see RESOLVED_RESULT_SOURCES in
// advance-results.service.ts) — without this, an imported game would sit there fully scored
// yet still show up as "needs input" forever. Best-effort, idempotent (upserts on the same
// records_apply_key the manual/screenshot prelog paths use), called after any schedule import.
export async function syncCompanionScheduleResultsIntoGameResults(leagueId: string): Promise<void> {
  const pool = getPgPool();
  // Debug: count total games and completed games for this league
  const debugCounts = await pool.query(
    `select
       count(*) filter (where source='madden_companion_export') as companion_games,
       count(*) filter (where source='madden_companion_export' and status='completed') as completed_games,
       count(*) filter (where source='madden_companion_export' and status='completed' and home_score is not null) as with_scores,
       count(*) filter (where source='madden_companion_export' and status='completed' and home_score is not null and home_team_id is not null) as ready_to_sync
     from rec_games where league_id=$1`,
    [leagueId],
  );
  const counts = debugCounts.rows[0];
  console.log(`[SYNC] Games for league ${leagueId}: companion=${counts?.companion_games}, completed=${counts?.completed_games}, with_scores=${counts?.with_scores}, ready=${counts?.ready_to_sync}`);

  const games = await pool.query<{
    id: string; week_number: number; phase: string; home_team_id: string; away_team_id: string;
    home_score: number; away_score: number; external_game_id: string | null;
  }>(
    `select id, week_number, phase, home_team_id, away_team_id, home_score, away_score, external_game_id
       from rec_games
      where league_id=$1 and source='madden_companion_export' and status='completed'
        and home_score is not null and away_score is not null and home_team_id is not null and away_team_id is not null`,
    [leagueId],
  );
  if (!games.rows.length) { console.log("[SYNC] No games ready to sync."); return; }
  console.log(`[SYNC] Syncing ${games.rows.length} games to rec_game_results`);

  const league = await pool.query<{ season_number: number }>("select season_number from rec_leagues where id=$1", [leagueId]);
  const seasonNumber = league.rows[0]?.season_number ?? 1;

  const teamIds = [...new Set(games.rows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const assignments = await pool.query<{ team_id: string; user_id: string }>(
    `select team_id, user_id from rec_team_assignments
      where league_id=$1 and assignment_status='active' and ended_at is null and team_id = any($2::uuid[])`,
    [leagueId, teamIds],
  );
  const userByTeam = new Map(assignments.rows.map((r) => [r.team_id, r.user_id]));

  // Each upsert goes out on its own pool connection (unlike the import path above, this isn't
  // wrapped in a single transaction/client), so running a bounded batch concurrently is safe and
  // cuts wall-clock time roughly 8x for a full-season sync — while keeping each game's
  // success/failure independent, since one bad row shouldn't block the rest of the sync.
  await mapWithConcurrency(games.rows, 8, async (g) => {
    const homeUserId = userByTeam.get(g.home_team_id) ?? null;
    const awayUserId = userByTeam.get(g.away_team_id) ?? null;
    const isTie = g.home_score === g.away_score;
    const homeWon = g.home_score > g.away_score;
    // Shared dedup key (also used by box score, manual entry, week-advance, and the EA direct
    // writer) so the same game never gets double-counted in official records — this used to be
    // its own ad hoc format, disjoint from every other source's key for the same rec_games.id.
    const applyKey = gameResultsApplyKey({
      gameId: g.id, leagueId, seasonNumber, weekNumber: g.week_number, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id,
    });
    await pool.query(
      `insert into rec_game_results
         (league_id, game_id, season_number, week_number, game_type, external_game_id, home_team_id, away_team_id,
          home_user_id, away_user_id, home_score, away_score, winning_user_id, losing_user_id, winning_team_id,
          losing_team_id, is_user_h2h, is_cpu_game, is_tie, is_playoff, source, records_apply_key, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'madden_companion_import',$21,now(),now())
       on conflict (records_apply_key) do update set
         home_user_id=excluded.home_user_id, away_user_id=excluded.away_user_id,
         home_score=excluded.home_score, away_score=excluded.away_score, winning_user_id=excluded.winning_user_id,
         losing_user_id=excluded.losing_user_id, winning_team_id=excluded.winning_team_id, losing_team_id=excluded.losing_team_id,
         is_tie=excluded.is_tie, source='madden_companion_import', updated_at=now()
       where rec_game_results.source = 'madden_companion_import'`,
      [
        leagueId, g.id, seasonNumber, g.week_number, g.phase === "playoffs" ? "postseason" : "regular_season",
        g.external_game_id, g.home_team_id, g.away_team_id, homeUserId, awayUserId, g.home_score, g.away_score,
        isTie ? null : homeWon ? homeUserId : awayUserId, isTie ? null : homeWon ? awayUserId : homeUserId,
        isTie ? null : homeWon ? g.home_team_id : g.away_team_id, isTie ? null : homeWon ? g.away_team_id : g.home_team_id,
        Boolean(homeUserId && awayUserId), !(homeUserId && awayUserId), isTie, g.phase === "playoffs", applyKey,
      ],
    ).catch((error) => console.error(`[WARN] Failed to sync companion schedule result for game ${g.id} (non-fatal):`, error));
  });

  // rec_league_user_records / rec_season_user_records / rec_global_user_records are
  // maintained tables, not live views — nothing recomputed them after this sync wrote into
  // rec_game_results, so imported Madden games never showed up in anyone's W/L record (box
  // score approval and manual/advance score entry all trigger this same rebuild; this was
  // the one write path into rec_game_results that didn't).
  await rebuildOfficialRecordsAfterBoxScore({ leagueId, seasonNumber }).catch((error) =>
    console.error("[WARN] Failed to rebuild official records after companion schedule sync (non-fatal):", error));
}

export async function listCompanionImportJobs(leagueId: string) {
  const result = await getPgPool().query<{
    id: string; task_key: string; status: string; completed_at: string | null; record_count: number;
    rolled_back_at: string | null; duplicate_of_job_id: string | null;
  }>(
    `select id, task_key, status, completed_at, record_count, rolled_back_at, duplicate_of_job_id
       from rec_import_jobs
      where league_id=$1 and source_type='madden_companion' and status='completed'
      order by completed_at desc limit 25`,
    [leagueId],
  );
  return result.rows;
}

/** Advance Readiness's Madden Companion status card — one URL, one status line, plus the
 * current week's per-game imported scores so the score-entry form can pre-fill from them. */
export async function getCompanionWeekStatus(leagueId: string, weekNumber: number) {
  const pool = getPgPool();
  // The connection's actual import URL is a one-time secret shown only at generation/rotation
  // (see registerCompanionConnection) — it's never stored in retrievable plaintext, so this can
  // only report whether a connection exists, not the URL itself. The UI links to League Mgmt >
  // Settings > Madden Companion for generating/copying it.
  const connection = await pool.query<{ id: string; last_health_status: string | null }>(
    `select id, last_health_status from rec_import_connections
      where league_id=$1 and connection_type='madden_companion' and status='active' order by created_at desc limit 1`,
    [leagueId],
  );
  const conn = connection.rows[0] ?? null;

  const games = await pool.query<{
    id: string; home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null; status: string;
  }>(
    `select id, home_team_id, away_team_id, home_score, away_score, status from rec_games
      where league_id=$1 and week_number=$2`,
    [leagueId, weekNumber],
  );
  const total = games.rows.length;
  const imported = games.rows.filter((g) => g.home_score != null && g.away_score != null && g.status === "completed");

  return {
    connected: Boolean(conn),
    connectionId: conn?.id ?? null,
    gamesTotal: total,
    gamesImported: imported.length,
    ready: total > 0 && imported.length === total,
    scores: imported.map((g) => ({ gameId: g.id, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id, homeScore: g.home_score, awayScore: g.away_score })),
  };
}

/** Reverts the most recent applied state of every canonical record a completed Companion
 * import job touched, using the version history captured at import time. A record that had no
 * prior version (this was its first-ever import) has nothing to revert to — for schedule
 * records that means clearing the score/status this job set rather than leaving stale data;
 * for every other record type (teams/rosters/standings/stats) the canonical row is left as-is
 * rather than risk deleting data other systems (custom players, team assignments) depend on. */
export async function rollbackCompanionImportJob(jobId: string, leagueId: string, requestedByUserId: string) {
  // Was previously a series of unwrapped pool.query calls — a failure partway through (e.g. a
  // dropped connection) could leave some canonical records reverted and others not, with no way
  // to retry cleanly (rolled_back_at never gets set, but some records are already mutated).
  // Wrapped in one transaction so a mid-failure leaves the database exactly as it was before the
  // rollback was attempted, matching the transactional guarantee ingestCompanionPayload already has.
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`madden-companion-rollback:${jobId}`]);

    const job = await client.query<{ id: string; league_id: string; task_key: MaddenEndpointKey; status: string; rolled_back_at: string | null }>(
      "select id, league_id, task_key, status, rolled_back_at from rec_import_jobs where id=$1", [jobId],
    );
    const row = job.rows[0];
    if (!row || row.league_id !== leagueId) throw new ApiError(404, "Import job not found.");
    if (row.status !== "completed") throw new ApiError(409, "Only a completed import can be rolled back.");
    if (row.rolled_back_at) throw new ApiError(409, "This import was already rolled back.");

    const records = await client.query<{
      id: string; record_key: string; source_game_id: string | null; week_number: number | null;
    }>(
      `select id, record_key, source_game_id, week_number from rec_madden_companion_records where last_import_job_id=$1`,
      [jobId],
    );

    let reverted = 0;
    let cleared = 0;
    for (const record of records.rows) {
      const priorVersion = await client.query<{ import_job_id: string; normalized_data: unknown; raw_data: unknown }>(
        `select import_job_id, normalized_data, raw_data from rec_madden_companion_record_versions
          where record_id=$1 order by created_at desc offset 1 limit 1`,
        [record.id],
      );
      const prior = priorVersion.rows[0];
      if (prior) {
        await client.query(
          `update rec_madden_companion_records
              set normalized_data=$2::jsonb, raw_data=$3::jsonb, last_import_job_id=$4, updated_at=now()
            where id=$1`,
          [record.id, JSON.stringify(prior.normalized_data), JSON.stringify(prior.raw_data), prior.import_job_id],
        );
        // Re-derive the canonical row (rec_games score, rec_players attributes, etc.) from the
        // restored data the same way a fresh import would — reusing applySchedule's upsert path
        // directly for the one case Advance Readiness depends on; other endpoint types keep
        // their now-reverted rec_madden_companion_records row but the canonical row itself is
        // only re-derived for schedule (see class comment).
        if (row.task_key === "schedule") {
          const raw = prior.raw_data as Record<string, unknown>;
          const homeScore = typeof raw.homeScore === "number" ? raw.homeScore : typeof raw.home_score === "number" ? raw.home_score : null;
          const awayScore = typeof raw.awayScore === "number" ? raw.awayScore : typeof raw.away_score === "number" ? raw.away_score : null;
          if (record.source_game_id) {
            await client.query(
              `update rec_games set home_score=$2, away_score=$3, status=$4, updated_at=now()
                where league_id=$1 and external_game_id=$5 and source='madden_companion_export'`,
              [leagueId, homeScore, awayScore, homeScore != null && awayScore != null ? "completed" : "scheduled", record.source_game_id],
            );
          }
        }
        reverted += 1;
      } else {
        // Nothing existed before this job — clear what it created rather than leave it dangling.
        if (row.task_key === "schedule" && record.source_game_id) {
          await client.query(
            `update rec_games set home_score=null, away_score=null, status='scheduled', import_verified=false, updated_at=now()
              where league_id=$1 and external_game_id=$2 and source='madden_companion_export'`,
            [leagueId, record.source_game_id],
          );
        }
        await client.query("delete from rec_madden_companion_records where id=$1", [record.id]);
        cleared += 1;
      }
    }

    if (row.task_key === "schedule") {
      await client.query("delete from rec_game_results where league_id=$1 and source='madden_companion_import' and week_number = any($2::int[])",
        [leagueId, [...new Set(records.rows.map((r) => r.week_number).filter((w): w is number => w != null))]]);
    }

    await client.query("update rec_import_jobs set rolled_back_at=now(), rolled_back_by_user_id=$2 where id=$1", [jobId, requestedByUserId]);
    await client.query("commit");

    // Best-effort, outside the transaction: re-derives rec_game_results from whatever schedule
    // records now exist post-rollback. Its own per-game writes are already upserts guarded by a
    // `source='madden_companion_import'` check, so re-running it is safe even if this throws.
    if (row.task_key === "schedule") {
      await syncCompanionScheduleResultsIntoGameResults(leagueId).catch((error) =>
        console.error("[WARN] Failed to resync schedule results after rollback (non-fatal):", error));
    }

    return { reverted, cleared };
  } catch (error) {
    await bestEffort("pg.rollback", () => client.query("rollback"));
    throw error;
  } finally {
    client.release();
  }
}
