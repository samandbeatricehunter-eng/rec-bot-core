// EA (Madden) import connection orchestration.
//
// Layers on top of the raw Blaze/accounts client in ./ea-client.ts and the
// canonical ingest pipeline in ../madden-companion/madden-companion.service.ts.
// The OAuth link flow is:
//   begin -> paste EA redirect URL (code) -> pick a persona -> sealed token persisted
//   (rec_ea_connections, AES-256-GCM via ./ea-token-vault.ts)
//   -> list the EA franchises the persona owns -> bind one to this REC league
//   -> import enabled datasets, each rewritten by ./ea-datasets.ts into the
//   companion envelope shape and run through ingestCompanionPayload with
//   source_type 'madden_direct_sync' so audit/rollback can tell a pull from
//   EA apart from a Companion App push.

import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import type { CompanionConnection } from "../madden-companion/madden-companion.service.js";
import { ingestCompanionPayload, recUserIdFromDiscordId, syncCompanionScheduleResultsIntoGameResults } from "../madden-companion/madden-companion.service.js";
import { processGameIntelligence } from "../box-score-intelligence/persistence.js";
import {
  BLAZE_COMPONENT_NAME,
  EA_LOGIN_URL,
  isEaImportConfigured,
} from "./ea-constants.js";
import {
  extractAuthCode,
  createBlazeSession,
  createEaClient,
  exchangeCodeForToken,
  getMaddenPersonas,
  getPersonaScopedToken,
  BlazeSessionError,
  EaAuthError,
  type MaddenPersona,
} from "./ea-client.js";
import {
  EA_DATASETS,
  EA_DATASET_LABELS,
  endpointKeyForDataset,
  parseDatasets,
  toIngestEnvelope,
  WEEKLY_DATASETS,
  type EaDataset,
} from "./ea-datasets.js";
import {
  isTokenExpired,
  openToken,
  sealToken,
  type EaSessionCache,
  type EaTokenRecord,
} from "./ea-token-vault.js";
import { currentWeekFromSeasonInfo, describeEaWeek, type EaStage, type EaWeekRef } from "./ea-weeks.js";

export type { EaDataset };

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

type EaConnectionRow = {
  id: string;
  league_id: string;
  blaze_persona_id: string;
  persona_display_name: string | null;
  ea_namespace: string | null;
  console: string;
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  token_expires_at: string;
  session_key: string | null;
  session_blaze_id: string | null;
  session_request_id: number;
  ea_league_id: string | null;
  ea_league_name: string | null;
  ea_season_year: number | null;
  enabled_datasets: string[] | null;
  auto_import: boolean;
  status: string;
  last_error: string | null;
  last_import_at: string | null;
  last_refreshed_at: string | null;
  connected_by_user_id: string | null;
  created_at: string;
};

type PendingAuthRow = {
  id: string;
  league_id: string;
  requested_by_user_id: string | null;
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  personas: Array<Record<string, unknown>>;
  expires_at: string;
  created_at: string;
};

export type EaPersonaOption = {
  personaId: number;
  displayName: string;
  name: string;
  namespaceName: string;
  console: string;
};

export type EaConnectionSummary = {
  id: string;
  leagueId: string;
  console: string;
  personaDisplayName: string | null;
  eaNamespace: string | null;
  eaLeagueId: string | null;
  eaLeagueName: string | null;
  eaSeasonYear: number | null;
  enabledDatasets: EaDataset[];
  autoImport: boolean;
  status: string;
  lastError: string | null;
  lastImportAt: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
};

export type EaFranchiseSummary = {
  leagueId: number;
  leagueName: string;
  calendarYear: number;
  numMembers: number;
  userTeamId: number;
  userTeamName: string;
  seasonText: string;
  currentWeekCompleted: boolean;
};

export type EaImportResult = {
  dataset: EaDataset;
  label: string;
  importJobId: string | null;
  duplicate: boolean;
  recordsStored: number;
};

function toSummary(row: EaConnectionRow): EaConnectionSummary {
  return {
    id: row.id,
    leagueId: row.league_id,
    console: row.console,
    personaDisplayName: row.persona_display_name,
    eaNamespace: row.ea_namespace,
    eaLeagueId: row.ea_league_id,
    eaLeagueName: row.ea_league_name,
    eaSeasonYear: row.ea_season_year,
    enabledDatasets: parseDatasets(row.enabled_datasets),
    autoImport: row.auto_import,
    status: row.status,
    lastError: row.last_error,
    lastImportAt: row.last_import_at,
    lastRefreshedAt: row.last_refreshed_at,
    createdAt: row.created_at,
  };
}

function openEaToken(row: Pick<EaConnectionRow, "token_ciphertext" | "token_iv" | "token_tag">): EaTokenRecord {
  return openToken({ ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag });
}

async function updateSealedToken(connectionId: string, token: EaTokenRecord) {
  const sealed = sealToken(token);
  await getPgPool().query(
    `update rec_ea_connections
        set token_ciphertext=$2, token_iv=$3, token_tag=$4,
            token_expires_at=to_timestamp($5 / 1000.0), last_refreshed_at=now(), status='active', updated_at=now()
      where id=$1`,
    [connectionId, sealed.ciphertext, sealed.iv, sealed.tag, token.expiresAt],
  );
}

/** Returns a non-expired token, refreshing and re-sealing if necessary. */
async function refreshedToken(row: EaConnectionRow): Promise<EaTokenRecord> {
  const current = openEaToken(row);
  if (!isTokenExpired(current)) return current;
  const { refreshEaToken } = await import("./ea-client.js");
  const refreshed = await refreshEaToken(current.refreshToken);
  const next: EaTokenRecord = { ...refreshed, console: current.console, blazePersonaId: current.blazePersonaId };
  await updateSealedToken(row.id, next);
  return next;
}

/** Reuses a cached Blaze session when one exists (EA rate limits logins). */
async function cachedSession(row: EaConnectionRow): Promise<EaSessionCache | null> {
  if (!row.session_key || row.session_blaze_id == null) return null;
  return { blazeId: Number(row.session_blaze_id), sessionKey: row.session_key, requestId: row.session_request_id ?? 1 };
}

async function persistSession(connectionId: string, session: EaSessionCache) {
  await getPgPool().query(
    `update rec_ea_connections set session_key=$2, session_blaze_id=$3, session_request_id=$4, updated_at=now() where id=$1`,
    [connectionId, session.sessionKey, session.blazeId, session.requestId],
  );
}

async function clearSession(connectionId: string) {
  await getPgPool().query(
    `update rec_ea_connections set session_key=null, session_blaze_id=null, updated_at=now() where id=$1`,
    [connectionId],
  );
}

async function loadEaConnection(connectionId: string, leagueId: string): Promise<EaConnectionRow> {
  const result = await getPgPool().query<EaConnectionRow>(
    `select * from rec_ea_connections where id=$1 and league_id=$2`,
    [connectionId, leagueId],
  );
  if (!result.rows[0]) throw new ApiError(404, "EA connection not found for this league.");
  return result.rows[0];
}

async function loadDirectSyncConnection(leagueId: string): Promise<CompanionConnection | null> {
  const result = await getPgPool().query<CompanionConnection>(
    `select id, league_id, endpoint_slug, external_league_id, config, status,
            last_health_check_at, last_health_status, created_at, updated_at
       from rec_import_connections
      where league_id=$1 and connection_type='madden_direct_sync' and status='active'
      limit 1`,
    [leagueId],
  );
  return result.rows[0] ?? null;
}

async function ensureDirectSyncConnection(leagueId: string, createdByUserId: string): Promise<CompanionConnection> {
  const existing = await loadDirectSyncConnection(leagueId);
  if (existing) return existing;
  const result = await getPgPool().query<CompanionConnection>(
    `insert into rec_import_connections (league_id, connection_type, status, config, created_by_user_id)
     values ($1,'madden_direct_sync','active',$2::jsonb,$3)
     on conflict do nothing
     returning id, league_id, endpoint_slug, external_league_id, config, status,
               last_health_check_at, last_health_status, created_at, updated_at`,
    [leagueId, JSON.stringify({ endpoint_keys: [], rate_limit_per_minute: 120, max_payload_bytes: 50 * 1024 * 1024 }), createdByUserId],
  );
  return result.rows[0] ?? (await loadDirectSyncConnection(leagueId))!;
}

function syncDirectSyncEndpointKeys(connectionId: string, datasets: EaDataset[]) {
  const endpointKeys = [...new Set(datasets.map(endpointKeyForDataset))];
  return getPgPool().query(
    `update rec_import_connections set config = jsonb_set(config, '{endpoint_keys}', $2::jsonb), updated_at=now() where id=$1`,
    [connectionId, JSON.stringify(endpointKeys)],
  );
}

// ── Link flow ──

export function requireEaImportConfigured(): void {
  if (!isEaImportConfigured()) {
    throw new ApiError(503, "EA import is not configured on this server (EA_CLIENT_SECRET / EA_TOKEN_ENC_KEY unset).");
  }
}

export async function beginEaLogin(leagueId: string, requestedByDiscordId: string): Promise<{ loginUrl: string; expiresInSeconds: number }> {
  requireEaImportConfigured();
  const userId = await recUserIdFromDiscordId(requestedByDiscordId);
  // Clear any stale handoff rows for this league so a fresh login always wins.
  await getPgPool().query("delete from rec_ea_pending_auth where league_id=$1 and expires_at < now()", [leagueId]);
  await getPgPool().query(
    `insert into rec_ea_pending_auth (league_id, requested_by_user_id, token_ciphertext, token_iv, token_tag, personas, expires_at)
     select $1, $2, '', '', '', '[]'::jsonb, now() + interval '1 millisecond'
     where not exists (select 1 from rec_ea_pending_auth where league_id=$1 and requested_by_user_id=$2)`,
    [leagueId, userId],
  );
  return { loginUrl: EA_LOGIN_URL, expiresInSeconds: Math.floor(PENDING_AUTH_TTL_MS / 1000) };
}

export async function submitEaCode(leagueId: string, requestedByDiscordId: string, pasted: string): Promise<{ pendingAuthId: string; personas: EaPersonaOption[] }> {
  requireEaImportConfigured();
  const userId = await recUserIdFromDiscordId(requestedByDiscordId);
  const code = extractAuthCode(pasted);
  const temporary = await exchangeCodeForToken(code);
  const { personas: maddenPersonas } = await getMaddenPersonas(temporary.access_token);
  if (maddenPersonas.length === 0) {
    throw new ApiError(422, "This EA account has no Madden gamertag on a supported platform.");
  }
  const personas: EaPersonaOption[] = maddenPersonas.map((persona) => ({
    personaId: persona.personaId,
    displayName: persona.displayName,
    name: persona.name,
    namespaceName: persona.namespaceName,
    console: persona.console,
  }));
  const sealed = sealToken({
    accessToken: temporary.access_token,
    refreshToken: temporary.refresh_token ?? "",
    expiresAt: Date.now() + (temporary.expires_in ?? 3600) * 1000,
    console: "pc",
    blazePersonaId: "pending",
  });
  const result = await getPgPool().query<PendingAuthRow>(
    `insert into rec_ea_pending_auth (league_id, requested_by_user_id, token_ciphertext, token_iv, token_tag, personas, expires_at)
     values ($1,$2,$3,$4,$5,$6::jsonb, now() + $7::interval)
     on conflict do nothing
     returning id, league_id, requested_by_user_id, token_ciphertext, token_iv, token_tag, personas, expires_at, created_at`,
    [leagueId, userId, sealed.ciphertext, sealed.iv, sealed.tag, JSON.stringify(personas), `${PENDING_AUTH_TTL_MS} milliseconds`],
  );
  const pending = result.rows[0];
  if (!pending) throw new ApiError(409, "A login is already in progress for this league. Finish or retry it.");
  return { pendingAuthId: pending.id, personas };
}

export async function selectEaPersona(
  leagueId: string,
  requestedByDiscordId: string,
  pendingAuthId: string,
  personaId: number,
): Promise<EaConnectionSummary> {
  requireEaImportConfigured();
  const userId = await recUserIdFromDiscordId(requestedByDiscordId);
  const pendingResult = await getPgPool().query<PendingAuthRow>(
    `select * from rec_ea_pending_auth where id=$1 and league_id=$2 and requested_by_user_id=$3`,
    [pendingAuthId, leagueId, userId],
  );
  const pending = pendingResult.rows[0];
  if (!pending) throw new ApiError(404, "Pending EA login not found for this league.");
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await getPgPool().query("delete from rec_ea_pending_auth where id=$1", [pending.id]);
    throw new ApiError(410, "That EA login has expired. Start a new login and paste a fresh URL.");
  }
  const persona = (pending.personas ?? []).find((p) => Number(p.personaId) === Number(personaId)) as EaPersonaOption | undefined;
  if (!persona) throw new ApiError(422, "That gamertag is not part of this login.");
  if (!["xone", "ps4", "pc", "ps5", "xbsx", "stadia"].includes(persona.console)) {
    throw new ApiError(422, "Unsupported console for that gamertag.");
  }

  const temporary = openEaToken(pending);
  const personaToken = await getPersonaScopedToken(temporary.accessToken, persona.personaId, persona.namespaceName as "xbox" | "ps3" | "cem_ea_id" | "stadia");
  const sealed = sealToken({
    ...personaToken,
    console: persona.console as EaTokenRecord["console"],
    blazePersonaId: String(persona.personaId),
  });

  const result = await getPgPool().query<EaConnectionRow>(
    `insert into rec_ea_connections
       (league_id, blaze_persona_id, persona_display_name, ea_namespace, console,
        token_ciphertext, token_iv, token_tag, token_expires_at, enabled_datasets,
        connected_by_user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9 / 1000.0),$10::jsonb,$11)
     on conflict (league_id) do update set
       blaze_persona_id=excluded.blaze_persona_id, persona_display_name=excluded.persona_display_name,
       ea_namespace=excluded.ea_namespace, console=excluded.console,
       token_ciphertext=excluded.token_ciphertext, token_iv=excluded.token_iv, token_tag=excluded.token_tag,
       token_expires_at=excluded.token_expires_at, enabled_datasets=excluded.enabled_datasets,
       session_key=null, session_blaze_id=null, ea_league_id=null, ea_league_name=null,
       ea_season_year=null, status='active', last_error=null, connected_by_user_id=excluded.connected_by_user_id,
       updated_at=now()
     returning *`,
    [leagueId, String(persona.personaId), persona.displayName, persona.namespaceName, persona.console,
      sealed.ciphertext, sealed.iv, sealed.tag, personaToken.expiresAt, JSON.stringify(EA_DATASETS), userId],
  );
  const row = result.rows[0];
  await getPgPool().query("delete from rec_ea_pending_auth where id=$1", [pending.id]);
  const direct = await ensureDirectSyncConnection(leagueId, userId);
  await syncDirectSyncEndpointKeys(direct.id, parseDatasets(row.enabled_datasets));
  return toSummary(row);
}

// ── Status / franchise binding ──

export async function getEaConnectionStatus(leagueId: string): Promise<{ configured: boolean; connection: EaConnectionSummary | null }> {
  // Defensive: a transient/missing-table Postgres error must surface as a structured error,
  // never as an unhandled throw that reaches Fastify's generic 500 handler. Callers (the
  // Import Data modal) need the chooser to render even if the connection row can't be read.
  try {
    const result = await getPgPool().query<EaConnectionRow>(
      `select * from rec_ea_connections where league_id=$1 order by updated_at desc limit 1`,
      [leagueId],
    );
    return { configured: isEaImportConfigured(), connection: result.rows[0] ? toSummary(result.rows[0]) : null };
  } catch (error) {
    console.error("[EA] getEaConnectionStatus failed:", error);
    return { configured: isEaImportConfigured(), connection: null };
  }
}

export async function listEaLeagues(connectionId: string, leagueId: string): Promise<EaFranchiseSummary[]> {
  requireEaImportConfigured();
  const row = await loadEaConnection(connectionId, leagueId);
  const token = await refreshedToken(row);
  const session = await cachedSession(row) ?? await createBlazeSession(token.accessToken, token.console);
  if (!cachedSession(row)) await persistSession(row.id, session);
  const client = createEaClient({ accessToken: token.accessToken, console: token.console }, session);
  try {
    const leagues = await client.getLeagues();
    return leagues.map((league) => ({
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      calendarYear: league.calendarYear,
      numMembers: league.numMembers,
      userTeamId: league.userTeamId,
      userTeamName: league.userTeamName,
      seasonText: league.seasonText,
      currentWeekCompleted: league.currentWeekCompleted,
    }));
  } catch (error) {
    if (error instanceof BlazeSessionError) {
      await clearSession(row.id);
      const fresh = await createBlazeSession(token.accessToken, token.console);
      await persistSession(row.id, fresh);
      const retry = createEaClient({ accessToken: token.accessToken, console: token.console }, fresh);
      return (await retry.getLeagues()).map((league) => ({
        leagueId: league.leagueId, leagueName: league.leagueName, calendarYear: league.calendarYear,
        numMembers: league.numMembers, userTeamId: league.userTeamId, userTeamName: league.userTeamName,
        seasonText: league.seasonText, currentWeekCompleted: league.currentWeekCompleted,
      }));
    }
    throw error;
  }
}

export async function bindEaLeague(connectionId: string, leagueId: string, eaLeagueId: number): Promise<EaConnectionSummary> {
  requireEaImportConfigured();
  const row = await loadEaConnection(connectionId, leagueId);
  const token = await refreshedToken(row);
  const session = await cachedSession(row) ?? await createBlazeSession(token.accessToken, token.console);
  if (!cachedSession(row)) await persistSession(row.id, session);
  const client = createEaClient({ accessToken: token.accessToken, console: token.console }, session);

  let info: Awaited<ReturnType<typeof client.getLeagueInfo>>;
  try {
    info = await client.getLeagueInfo(eaLeagueId);
  } catch (error) {
    if (error instanceof BlazeSessionError) {
      await clearSession(row.id);
      const fresh = await createBlazeSession(token.accessToken, token.console);
      await persistSession(row.id, fresh);
      info = await createEaClient({ accessToken: token.accessToken, console: token.console }, fresh).getLeagueInfo(eaLeagueId);
    } else {
      throw error;
    }
  }
  if (!info.success) throw new ApiError(422, `EA rejected that franchise: ${info.message ?? "unknown error"}`);

  const seasonYear = info.careerHubInfo?.seasonInfo?.seasonYear ?? null;
  const result = await getPgPool().query<EaConnectionRow>(
    `update rec_ea_connections set ea_league_id=$2, ea_league_name=$3, ea_season_year=$4, status='active', updated_at=now() where id=$1 returning *`,
    [connectionId, String(eaLeagueId), info.careerHubInfo?.seasonInfo?.seasonTitle ?? null, seasonYear],
  );
  const direct = await loadDirectSyncConnection(leagueId);
  if (direct) {
    await getPgPool().query(
      `update rec_import_connections set external_league_id=$2, updated_at=now() where id=$1`,
      [direct.id, String(eaLeagueId)],
    );
  }
  return toSummary(result.rows[0]);
}

export async function updateEaConnectionSettings(
  connectionId: string,
  leagueId: string,
  datasets: EaDataset[] | undefined,
  autoImport: boolean | undefined,
): Promise<EaConnectionSummary> {
  const row = await loadEaConnection(connectionId, leagueId);
  const nextDatasets = datasets !== undefined ? parseDatasets(datasets) : parseDatasets(row.enabled_datasets);
  const nextAuto = autoImport !== undefined ? autoImport : row.auto_import;
  const result = await getPgPool().query<EaConnectionRow>(
    `update rec_ea_connections set enabled_datasets=$2::jsonb, auto_import=$3, updated_at=now() where id=$1 returning *`,
    [connectionId, JSON.stringify(nextDatasets), nextAuto],
  );
  const direct = await loadDirectSyncConnection(leagueId);
  if (direct) await syncDirectSyncEndpointKeys(direct.id, nextDatasets);
  return toSummary(result.rows[0]);
}

// ── Import ──

export type EaImportOptions = {
  datasets?: EaDataset[];
  stage?: EaStage;
  weekIndex?: number;
  /** Explicit week list (specific week or a span expanded by the caller). When present it
   *  replaces the single stage/weekIndex for weekly datasets; snapshots import once. */
  weekRefs?: EaWeekRef[];
};

export type EaImportProgressEvent =
  | { type: "starting"; datasets: string[]; weeks: number }
  | { type: "dataset_start"; dataset: string; label: string }
  | { type: "dataset_done"; dataset: string; label: string; records: number; duplicate: boolean }
  | { type: "dataset_error"; dataset: string; label: string; error: string }
  | { type: "reconciling"; step: string }
  | { type: "done"; results: EaImportResult[] }
  | { type: "error"; error: string };

export async function importEaDatasetsWithProgress(
  connectionId: string,
  leagueId: string,
  options: EaImportOptions = {},
  onProgress: (event: EaImportProgressEvent) => void,
): Promise<EaImportResult[]> {
  requireEaImportConfigured();
  const row = await loadEaConnection(connectionId, leagueId);
  const direct = await loadDirectSyncConnection(leagueId);
  if (!direct) throw new ApiError(409, "EA import is not initialized. Re-link the league to EA.");
  if (!row.ea_league_id) throw new ApiError(409, "No EA franchise is bound to this league yet. Choose a franchise first.");

  const datasets = options.datasets !== undefined ? parseDatasets(options.datasets) : parseDatasets(row.enabled_datasets);
  if (datasets.length === 0) throw new ApiError(422, "No datasets are enabled for import.");

  const token = await refreshedToken(row);
  // Create Blaze session with retry — ERR_SYSTEM often means a stale token, so force
  // a token refresh and retry once before giving up.
  let session: EaSessionCache;
  const cached = await cachedSession(row);
  if (cached) {
    session = cached;
  } else {
    try {
      session = await createBlazeSession(token.accessToken, token.console);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ERR_SYSTEM") || message.includes("ERR_TIMEOUT")) {
        console.warn("[EA] Blaze session creation failed, refreshing token and retrying:", message);
        const { refreshEaToken } = await import("./ea-client.js");
        const refreshed = await refreshEaToken(token.refreshToken);
        const next: EaTokenRecord = { ...refreshed, console: token.console, blazePersonaId: token.blazePersonaId };
        await updateSealedToken(row.id, next);
        token.accessToken = refreshed.accessToken;
        token.refreshToken = refreshed.refreshToken;
        token.expiresAt = refreshed.expiresAt;
        session = await createBlazeSession(refreshed.accessToken, token.console);
      } else {
        throw error;
      }
    }
    await persistSession(row.id, session);
  }
  const client = createEaClient({ accessToken: token.accessToken, console: token.console }, session);

  // Keep the Blaze session alive. Sends a single keepalive ping, then runs the operation.
  // If the session dies, recreates it (with token refresh if needed) and retries once.
  let activeSession = session;
  let lastKeepAlive = 0;
  const runWithFreshSession = async <T>(operation: (client: ReturnType<typeof createEaClient>) => Promise<T>): Promise<T> => {
    const now = Date.now();
    // Keepalive at most once per 30 seconds to avoid hammering EA
    if (now - lastKeepAlive > 30_000) {
      lastKeepAlive = now;
      try {
        const ka = createEaClient({ accessToken: token.accessToken, console: token.console }, activeSession);
        await ka.keepAlive();
      } catch { /* session dead — will recreate below if needed */ }
    }
    try {
      const opClient = createEaClient({ accessToken: token.accessToken, console: token.console }, activeSession);
      return await operation(opClient);
    } catch (error) {
      const isSessionError = error instanceof BlazeSessionError;
      const isAuthError = error instanceof EaAuthError;
      if (!isSessionError && !isAuthError) throw error;
      console.warn("[EA] Blaze session stale, recreating:", error instanceof Error ? error.message.slice(0, 200) : error);
      await clearSession(row.id);
      try {
        activeSession = await createBlazeSession(token.accessToken, token.console);
      } catch {
        const { refreshEaToken } = await import("./ea-client.js");
        const refreshed = await refreshEaToken(token.refreshToken);
        const next: EaTokenRecord = { ...refreshed, console: token.console, blazePersonaId: token.blazePersonaId };
        await updateSealedToken(row.id, next);
        token.accessToken = refreshed.accessToken;
        token.refreshToken = refreshed.refreshToken;
        token.expiresAt = refreshed.expiresAt;
        activeSession = await createBlazeSession(refreshed.accessToken, token.console);
      }
      await persistSession(row.id, activeSession);
      lastKeepAlive = Date.now();
      const freshClient = createEaClient({ accessToken: token.accessToken, console: token.console }, activeSession);
      return await operation(freshClient);
    }
  };

  const eaLeagueId = Number(row.ea_league_id);
  const info = await runWithFreshSession((c) => c.getLeagueInfo(eaLeagueId));
  const seasonYear = info.careerHubInfo?.seasonInfo?.seasonYear ?? row.ea_season_year ?? new Date().getFullYear();
  const seasonInfo = info.careerHubInfo?.seasonInfo;
  const teamIdInfoList = info.teamIdInfoList ?? [];

  // Build the list of weeks to import. When no explicit week is requested (the default),
  // import ALL weeks up to and including the current week — not just the current week.
  // EA's schedule/stats exports are per-week, so importing only the current week misses
  // all previously played games' scores.
  const defaultWeekRef: EaWeekRef = options.stage !== undefined && options.weekIndex !== undefined
    ? { stageIndex: options.stage, weekIndex: options.weekIndex }
    : seasonInfo
      ? currentWeekFromSeasonInfo({ seasonWeek: seasonInfo.seasonWeek, seasonWeekType: seasonInfo.seasonWeekType })
      : { stageIndex: 1, weekIndex: 0 };
  // An explicit week list drives weekly datasets; without one, import ALL weeks up to and
  // including the franchise's current week. This ensures previously played weeks' scores
  // are captured — EA's schedule export is per-week, so only requesting the current week
  // misses all completed games.
  const weeklyRefs = [...(options.weekRefs ?? (() => {
    const allWeeks: EaWeekRef[] = [];
    if (defaultWeekRef.stageIndex === 0) {
      // Preseason: import all preseason weeks up to current
      for (let i = 0; i <= defaultWeekRef.weekIndex; i++) allWeeks.push({ stageIndex: 0, weekIndex: i });
    } else {
      // Regular season + playoffs: import all weeks 0 through current, skipping Pro Bowl
      for (let i = 0; i <= defaultWeekRef.weekIndex; i++) {
        if (i !== 21) allWeeks.push({ stageIndex: 1, weekIndex: i });
      }
    }
    return allWeeks;
  })())].reduce<EaWeekRef[]>((unique, ref) => {
    const key = `${ref.stageIndex}:${ref.weekIndex}`;
    if (!unique.some((existing) => `${existing.stageIndex}:${existing.weekIndex}` === key)) unique.push(ref);
    return unique;
  }, []);

  const results: EaImportResult[] = [];
  let scheduleImported = false;
  const importedPlayerIds = new Set<string>();

  // First EA import for this league: wipe all baseline/seeded players so the EA data
  // becomes the sole source of truth. Custom player builds are preserved.
  if (!row.last_import_at && datasets.includes("rosters")) {
    onProgress({ type: "reconciling", step: "First import — clearing baseline roster…" });
    const wiped = await wipeBaselineRoster(leagueId);
    console.log(`[EA] First import: wiped ${wiped} baseline player(s) for league ${leagueId}`);
  }

  onProgress({ type: "starting", datasets: datasets.map(String), weeks: weeklyRefs.length });

  const importDatasetAtWeek = async (dataset: EaDataset, week: EaWeekRef) => {
    const t0 = Date.now();
    console.log(`[EA] Fetching ${dataset} week ${week.weekIndex}...`);
    const raw = await runWithFreshSession((c) => fetchDataset(c, dataset, eaLeagueId, week, teamIdInfoList));
    console.log(`[EA] Fetched ${dataset} week ${week.weekIndex} in ${Date.now() - t0}ms`);
    const envelope = toIngestEnvelope({
      dataset,
      raw,
      eaLeagueId,
      seasonYear,
      stage: week.stageIndex,
      weekIndex: week.weekIndex,
    });
    if (dataset === "rosters" || dataset === "free_agents") {
      const rows = (envelope.payload as { rosterInfoList?: Array<Record<string, unknown>> }).rosterInfoList ?? [];
      for (const row of rows) {
        const id = row.playerId ?? row.player_id ?? row.rosterId ?? row.roster_id;
        if (id != null) importedPlayerIds.add(String(id));
      }
    }
    const ingested = await ingestCompanionPayload(direct, envelope.endpointKey, envelope.payload, { "x-rec-ea-direct": "1" }, "madden_direct_sync");
    const label = weeklyRefs.length > 1
      ? `${EA_DATASET_LABELS[dataset]} — ${describeEaWeek(week.stageIndex, week.weekIndex).label}`
      : EA_DATASET_LABELS[dataset];
    const existing = results.find((result) => result.dataset === dataset && result.label === label);
    if (existing) {
      existing.recordsStored += ingested.records_stored;
      existing.duplicate = existing.duplicate && ingested.duplicate;
      existing.importJobId = ingested.import_job_id;
    } else {
      results.push({ dataset, label, importJobId: ingested.import_job_id, duplicate: ingested.duplicate, recordsStored: ingested.records_stored });
    }
    if (dataset === "schedule") scheduleImported = true;
    return { label, records: ingested.records_stored, duplicate: ingested.duplicate };
  };

  for (const dataset of datasets) {
    const datasetLabel = EA_DATASET_LABELS[dataset];
    onProgress({ type: "dataset_start", dataset: String(dataset), label: datasetLabel });
    try {
      if (WEEKLY_DATASETS.has(dataset)) {
        for (const week of weeklyRefs) {
          const result = await importDatasetAtWeek(dataset, week);
          onProgress({ type: "dataset_done", dataset: String(dataset), label: result.label, records: result.records, duplicate: result.duplicate });
        }
      } else {
        const result = await importDatasetAtWeek(dataset, defaultWeekRef);
        onProgress({ type: "dataset_done", dataset: String(dataset), label: result.label, records: result.records, duplicate: result.duplicate });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onProgress({ type: "dataset_error", dataset: String(dataset), label: datasetLabel, error: message });
      await getPgPool().query(
        `update rec_ea_connections set status='error', last_error=$2, updated_at=now() where id=$1`,
        [connectionId, `${dataset}: ${message}`],
      );
      throw new ApiError(502, `EA import failed for ${datasetLabel}: ${message}`);
    }
  }

  if (scheduleImported) {
    onProgress({ type: "reconciling", step: "Syncing game results…" });
    await syncCompanionScheduleResultsIntoGameResults(leagueId).catch((error) =>
      console.error("[WARN] Failed to sync EA schedule results into rec_game_results (non-fatal):", error));
  }
  // Process badges/stories for games that now have team_stats from the import.
  if (datasets.includes("team_stats") || datasets.includes("schedule")) {
    onProgress({ type: "reconciling", step: "Processing badges & headlines…" });
    const seasonNumber = seasonInfo?.seasonYear ?? row.ea_season_year ?? new Date().getFullYear();
    const affectedWeeks = [...new Set(weeklyRefs.map((w) => describeEaWeek(w.stageIndex, w.weekIndex).displayWeek))];
    for (const weekNumber of affectedWeeks) {
      const weekGames = await getPgPool().query<{ id: string }>(
        `select g.id from rec_games g where g.league_id=$1 and g.week_number=$2`,
        [leagueId, weekNumber],
      );
      for (const game of weekGames.rows) {
        await processGameIntelligence({
          id: `ea-import-${game.id}`,
          league_id: leagueId,
          season_number: seasonNumber,
          week_number: weekNumber,
          game_id: game.id,
        }).catch((error) =>
          console.error(`[WARN] Badge processing failed for game ${game.id} (non-fatal):`, error));
      }
    }
  }
  // Subsequent imports: reconcile — remove players no longer in the EA export.
  // First imports already wiped the baseline, so this only applies to re-imports.
  if (datasets.includes("rosters") && row.last_import_at && importedPlayerIds.size > 0) {
    onProgress({ type: "reconciling", step: "Reconciling rosters…" });
    await reconcileRostersToImport(leagueId, [...importedPlayerIds]).catch((error) =>
      console.error("[WARN] Failed to reconcile rosters against the EA import (non-fatal):", error));
  }
  // Match pending custom-player/legend purchases to the new imported players by name.
  if (datasets.includes("rosters")) {
    onProgress({ type: "reconciling", step: "Linking pending purchases to imported players…" });
    const matched = await reconcilePendingPurchasesToImport(leagueId).catch((error) => {
      console.error("[WARN] Failed to reconcile pending purchases to import (non-fatal):", error);
      return 0;
    });
    if (matched > 0) console.log(`[EA] Matched ${matched} pending purchase(s) to imported players.`);
  }
  await getPgPool().query(
    `update rec_ea_connections set status='active', last_error=null, last_import_at=now(), updated_at=now() where id=$1`,
    [connectionId],
  );
  onProgress({ type: "done", results });
  return results;
}

/** Backward-compatible wrapper — callers that don't need progress events. */
export async function importEaDatasets(connectionId: string, leagueId: string, options: EaImportOptions = {}): Promise<EaImportResult[]> {
  return importEaDatasetsWithProgress(connectionId, leagueId, options, () => {});
}

/**
 * Wipe baseline/seeded players that were NOT imported from EA (no madden_player_id).
 * EA-imported players, custom builds, and legends are preserved.
 */
export async function wipeBaselineRoster(leagueId: string): Promise<number> {
  const count = await getPgPool().query<{ id: string }>(
    `select id from rec_players where league_id=$1 and madden_player_id is null`,
    [leagueId],
  );
  if (!count.rows.length) return 0;
  try {
    await getPgPool().query(`delete from rec_players where league_id=$1 and madden_player_id is null`, [leagueId]);
    return count.rows.length;
  } catch {
    await getPgPool().query(
      `update rec_players set roster_status='removed', updated_at=now() where league_id=$1 and madden_player_id is null`,
      [leagueId],
    );
    return count.rows.length;
  }
}

/**
 * After the EA import creates all players, re-map pending custom-player and legend
 * purchases to the imported players. Approved/applied purchases don't need handling —
 * those players already exist in-game and were imported as regular EA players.
 * Pending purchases reference a (now-deleted) baseline player; match by name to the
 * imported player so the commissioner can apply them.
 */
export async function reconcilePendingPurchasesToImport(leagueId: string): Promise<number> {
  const pending = await getPgPool().query<{
    id: string; purchase_type: string; player_name: string; player_position: string;
  }>(
    `select id, purchase_type,
            coalesce(details->>'name', details->'build'->>'fullName', details->'replaceTarget'->>'firstName') as player_name,
            coalesce(details->>'position', details->'build'->>'position', details->'replaceTarget'->>'position') as player_position
       from rec_purchases
      where league_id=$1 and status='pending'
        and purchase_type in ('legend', 'custom_player')`,
    [leagueId],
  );
  if (!pending.rows.length) return 0;

  let matched = 0;
  for (const purchase of pending.rows) {
    if (!purchase.player_name) continue;
    const imported = await getPgPool().query<{ id: string }>(
      `select id from rec_players
        where league_id=$1 and lower(full_name) = lower($2) and madden_player_id is not null
        limit 1`,
      [leagueId, purchase.player_name],
    );
    if (!imported.rows[0]) continue;
    // Update the purchase's replaceTarget to point to the imported player
    await getPgPool().query(
      `update rec_purchases
         set details = jsonb_set(details, '{replaceTarget}', jsonb_build_object('playerId', $3::text), true),
             updated_at=now()
         where id=$1 and league_id=$2`,
      [purchase.id, leagueId, imported.rows[0].id],
    );
    matched += 1;
  }
  return matched;
}

/**
 * Source-of-truth reconciliation: the EA import defines the league's rosters. Players absent
 * from the imported rows are removed — imported rows themselves already upserted by
 * madden_player_id, overwriting any manually edited values. Players minted by custom-player
 * builds (paid content, referenced from rec_custom_player_builds.created_player_id) are
 * always spared. A hard delete can trip NO ACTION foreign keys (award nominees, fantasy
 * draft picks); those rows fall back to roster_status='removed' so they leave the active
 * roster either way.
 */
async function reconcileRostersToImport(leagueId: string, importedPlayerIds: string[]): Promise<void> {
  const staleFilter = `
    league_id=$1
    and madden_player_id::text <> all($2::text[])
    and not exists (
      select 1 from rec_custom_player_builds b
       where b.league_id=$1 and b.created_player_id = rec_players.id
    )`;
  const stale = await getPgPool().query<{ id: string }>(
    `select id from rec_players where ${staleFilter}`,
    [leagueId, importedPlayerIds],
  );
  if (!stale.rows.length) return;
  try {
    await getPgPool().query(`delete from rec_players where ${staleFilter}`, [leagueId, importedPlayerIds]);
    console.log(`[EA] Roster reconciliation: removed ${stale.rows.length} stale player(s) not present in the EA import.`);
  } catch (error) {
    // FK-blocked rows: retire them from the roster instead of deleting outright.
    await getPgPool().query(
      `update rec_players set roster_status='removed', updated_at=now() where ${staleFilter}`,
      [leagueId, importedPlayerIds],
    );
    console.warn(`[EA] Roster reconciliation: marked ${stale.rows.length} stale player(s) removed (blocked by references):`, error instanceof Error ? error.message : error);
  }
}

function fetchDataset(
  client: ReturnType<typeof createEaClient>,
  dataset: EaDataset,
  eaLeagueId: number,
  week: EaWeekRef,
  teamIdInfoList: Array<{ teamId: number; displayName: string; shortName: string; presentationId: number }>,
): Promise<unknown> {
  switch (dataset) {
    case "teams": return client.getTeams(eaLeagueId);
    case "standings": return client.getStandings(eaLeagueId);
    case "schedule": return client.getSchedules(eaLeagueId, week.stageIndex, week.weekIndex);
    case "passing": return client.getPassingStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "rushing": return client.getRushingStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "receiving": return client.getReceivingStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "defense": return client.getDefensiveStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "kicking": return client.getKickingStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "punting": return client.getPuntingStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "team_stats": return client.getTeamStats(eaLeagueId, week.stageIndex, week.weekIndex);
    case "rosters": return fetchAllTeamRosters(client, eaLeagueId, teamIdInfoList);
    case "free_agents": return client.getFreeAgents(eaLeagueId);
  }
}

async function fetchAllTeamRosters(
  client: ReturnType<typeof createEaClient>,
  eaLeagueId: number,
  teamIdInfoList: Array<{ teamId: number; displayName: string; shortName: string; presentationId: number }>,
): Promise<unknown> {
  const allRows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < teamIdInfoList.length; index += 1) {
    const team = teamIdInfoList[index]!;
    const raw = await client.getTeamRoster(eaLeagueId, team.teamId, index);
    const rows = extractRows(raw);
    for (const row of rows) {
      if (row.teamId === undefined) row.teamId = team.teamId;
    }
    allRows.push(...rows);
  }
  return allRows;
}

function extractRows(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  }
  if (!raw || typeof raw !== "object") return [];
  const container = raw as Record<string, unknown>;
  const arrays = Object.values(container).filter((value): value is unknown[] => Array.isArray(value));
  if (arrays.length === 1) return arrays[0].filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  return [];
}

export async function disconnectEaConnection(connectionId: string, leagueId: string): Promise<void> {
  await loadEaConnection(connectionId, leagueId);
  await getPgPool().query("delete from rec_ea_connections where id=$1 and league_id=$2", [connectionId, leagueId]);
  await getPgPool().query(
    `delete from rec_import_connections where league_id=$1 and connection_type='madden_direct_sync'`,
    [leagueId],
  );
}

export async function listEaImportJobs(leagueId: string) {
  try {
    const result = await getPgPool().query<{
      id: string; task_key: string; status: string; completed_at: string | null; record_count: number;
      rolled_back_at: string | null; duplicate_of_job_id: string | null;
    }>(
      `select id, task_key, status, completed_at, record_count, rolled_back_at, duplicate_of_job_id
         from rec_import_jobs
        where league_id=$1 and source_type='madden_direct_sync'
          and (status='completed' or status='processing')
          and rolled_back_at is null
        order by created_at desc limit 25`,
      [leagueId],
    );
    return result.rows;
  } catch (error) {
    console.error("[EA] listEaImportJobs failed:", error);
    return [];
  }
}
