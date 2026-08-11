import crypto from "node:crypto";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { companionChecksum, normalizeCompanionPayload, splitCompanionPayload } from "./madden-companion.adapters.js";
import { applyCompanionRecordToCanonical } from "./madden-companion.canonical.js";

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

export async function ingestCompanionPayload(connection: CompanionConnection, endpointKey: MaddenEndpointKey, payload: unknown, requestHeaders: Record<string, string>): Promise<IngestResult> {
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
        where connection_id=$1 and source_type='madden_companion' and created_at >= now() - interval '1 minute'`,
      [connection.id],
    );
    if ((rate.rows[0]?.count ?? 0) >= (connection.config.rate_limit_per_minute ?? 60)) {
      throw new ApiError(429, "Companion import rate limit exceeded; retry in one minute.");
    }

    const duplicate = await client.query<{ id: string; record_count: number }>(
      `select id, record_count from rec_import_jobs
        where league_id=$1 and connection_id=$2 and task_key=$3 and source_checksum=$4
          and source_type='madden_companion' and duplicate_of_job_id is null
        limit 1`,
      [connection.league_id, connection.id, endpointKey, payloadChecksum],
    );
    if (duplicate.rows[0]) {
      await client.query(
        `update rec_import_connections set last_health_check_at=now(), last_health_status='duplicate_ignored', updated_at=now() where id=$1`,
        [connection.id],
      );
      await client.query("commit");
      return { accepted: true, import_job_id: duplicate.rows[0].id, duplicate: true, records_stored: duplicate.rows[0].record_count };
    }

    const fallbackSeason = await client.query<{ season_number: number }>("select season_number from rec_leagues where id=$1", [connection.league_id]);
    if (!fallbackSeason.rows[0]) throw new ApiError(404, "REC league not found.");
    const externalSeasonKey = records.find((record) => record.externalSeasonKey !== "current")?.externalSeasonKey
      ?? String(fallbackSeason.rows[0].season_number);

    const job = await client.query<{ id: string }>(
      `insert into rec_import_jobs
         (league_id, connection_id, source_type, task_key, status, started_at, source_checksum, external_season_key, record_count)
       values ($1,$2,'madden_companion',$3,'processing',now(),$4,$5,$6)
       returning id`,
      [connection.league_id, connection.id, endpointKey, payloadChecksum, externalSeasonKey, records.length],
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

    for (const record of records) {
      const seasonKey = record.externalSeasonKey === "current" ? externalSeasonKey : record.externalSeasonKey;
      const stored = await client.query<{ id: string }>(
        `insert into rec_madden_companion_records
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
         returning id`,
        [connection.league_id, connection.id, record.externalLeagueId, seasonKey, endpointKey, record.recordKey,
          record.sourceTeamId, record.sourcePlayerId, record.sourceGameId, record.weekNumber, record.statCategory,
          JSON.stringify(record.normalizedData), JSON.stringify(record.rawData), jobId],
      );
      await client.query(
        `insert into rec_madden_companion_record_versions(record_id, import_job_id, content_checksum, normalized_data, raw_data)
         values ($1,$2,$3,$4::jsonb,$5::jsonb) on conflict (record_id, content_checksum) do nothing`,
        [stored.rows[0].id, jobId, record.contentChecksum, JSON.stringify(record.normalizedData), JSON.stringify(record.rawData)],
      );
      await applyCompanionRecordToCanonical({ client, leagueId: connection.league_id, endpointKey, canonicalRecordId: stored.rows[0].id, seasonKey, record });
      await client.query(
        `insert into rec_import_records(import_job_id, league_id, record_type, entity_key, status, trust_level, applied_at)
         values ($1,$2,$3,$4,'applied','trusted_automated_import',now())`,
        [jobId, connection.league_id, endpointKey, `${seasonKey}:${record.recordKey}`],
      );
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
    return { accepted: true, import_job_id: jobId, duplicate: false, records_stored: records.length };
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
  return {
    accepted: true as const,
    imports,
    datasets_received: imports.length,
    records_stored: imports.reduce((total, item) => total + item.records_stored, 0),
  };
}

async function recUserIdFromDiscordId(discordId: string): Promise<string> {
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
