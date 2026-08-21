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
import { reconcileApprovedMaddenPurchases } from "../purchases/purchases.service.js";
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
  extractEaEnvelopeRows,
  eaUsernamesFromHub,
  parseDatasets,
  toIngestEnvelope,
  WEEKLY_DATASETS,
  type EaDataset,
} from "./ea-datasets.js";
import { chunkItems, EA_ROSTER_TEAM_BATCH, EA_WEEKLY_WEEK_BATCH, weeklyWriteOrder } from "./ea-import-batches.js";
import { directWriteSchedule, directWriteRoster } from "./ea-direct-writer.js";
import { shouldRetainPlayerAfterEaReconcile } from "./ea-roster-reconcile.js";
import {
  isTokenExpired,
  openToken,
  sealToken,
  type EaSessionCache,
  type EaTokenRecord,
} from "./ea-token-vault.js";
import { currentWeekFromSeasonInfo, describeEaWeek, resolveWeeklyImportRefs, type EaStage, type EaWeekRef, type EaWeekScope } from "./ea-weeks.js";

export type { EaDataset };

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

/** Extract rows from EA's export envelope (e.g. { gameScheduleInfoList: [...] }). */
function extractEaRows(raw: unknown, envelopeKey: string): Array<Record<string, unknown>> {
  return extractEaEnvelopeRows(raw, envelopeKey);
}

function collectImportedPlayerIds(raw: unknown, into: Set<string>): void {
  for (const row of extractEaRows(raw, "rosterInfoList")) {
    const id = row.rosterId ?? row.roster_id ?? row.playerId ?? row.player_id;
    if (id != null) into.add(String(id));
  }
}

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
  const existingSession = await cachedSession(row);
  const session = existingSession ?? await createBlazeSession(token.accessToken, token.console);
  if (!existingSession) await persistSession(row.id, session);
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
      try {
        return (await retry.getLeagues()).map((league) => ({
          leagueId: league.leagueId, leagueName: league.leagueName, calendarYear: league.calendarYear,
          numMembers: league.numMembers, userTeamId: league.userTeamId, userTeamName: league.userTeamName,
          seasonText: league.seasonText, currentWeekCompleted: league.currentWeekCompleted,
        }));
      } catch (retryError) {
        await recordEaImportError(row.id, retryError);
        throw retryError;
      }
    }
    await recordEaImportError(row.id, error);
    throw error;
  }
}

export async function bindEaLeague(connectionId: string, leagueId: string, eaLeagueId: number): Promise<EaConnectionSummary> {
  requireEaImportConfigured();
  const row = await loadEaConnection(connectionId, leagueId);
  const token = await refreshedToken(row);
  const existingSession = await cachedSession(row);
  const session = existingSession ?? await createBlazeSession(token.accessToken, token.console);
  if (!existingSession) await persistSession(row.id, session);
  const client = createEaClient({ accessToken: token.accessToken, console: token.console }, session);

  let info: Awaited<ReturnType<typeof client.getLeagueInfo>>;
  try {
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
  } catch (error) {
    await recordEaImportError(row.id, error);
    throw error;
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
   *  replaces week_scope / stage / weekIndex for weekly datasets; snapshots import once. */
  weekRefs?: EaWeekRef[];
  /** When weekRefs is omitted: `current` (default) is only the franchise week; `through_current`
   *  is every exportable week in that stage up through current. */
  weekScope?: EaWeekScope;
};

export type EaImportProgressEvent =
  | { type: "starting"; datasets: string[]; weeks: number }
  | { type: "dataset_start"; dataset: string; label: string }
  | { type: "dataset_done"; dataset: string; label: string; records: number; duplicate: boolean }
  | { type: "dataset_error"; dataset: string; label: string; error: string }
  | { type: "step"; step: number; stepCount: number; label: string; detail?: string }
  | { type: "reconciling"; step: string }
  | { type: "done"; results: EaImportResult[] }
  | { type: "error"; error: string };

// In-memory progress store keyed by leagueId — the import writes events here,
// the frontend polls them via /v1/import/madden/ea/import-progress.
type ImportProgressSource = "manual" | "auto";
const importProgressStore = new Map<string, { events: EaImportProgressEvent[]; startedAt: number; source: ImportProgressSource }>();

export function pushProgress(leagueId: string, event: EaImportProgressEvent) {
  const entry = importProgressStore.get(leagueId) ?? { events: [], startedAt: Date.now(), source: "manual" as const };
  entry.events.push(event);
  importProgressStore.set(leagueId, entry);
}

export function getImportProgress(leagueId: string): { events: EaImportProgressEvent[]; running: boolean; source: ImportProgressSource | null } {
  const entry = importProgressStore.get(leagueId);
  if (!entry) return { events: [], running: false, source: null };
  const done = entry.events.some((e) => e.type === "done" || e.type === "error");
  return { events: entry.events, running: !done, source: entry.source };
}

export function beginImportProgress(leagueId: string, source: ImportProgressSource) {
  importProgressStore.set(leagueId, { events: [], startedAt: Date.now(), source });
}

export function clearImportProgress(leagueId: string) {
  importProgressStore.delete(leagueId);
}

export async function importEaDatasetsWithProgress(
  connectionId: string,
  leagueId: string,
  options: EaImportOptions = {},
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
  let refreshInFlight: Promise<void> | null = null;
  const recreateSession = async () => {
    if (refreshInFlight) {
      await refreshInFlight;
      return;
    }
    refreshInFlight = (async () => {
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
    })().finally(() => {
      refreshInFlight = null;
    });
    await refreshInFlight;
  };
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
      await recreateSession();
      const freshClient = createEaClient({ accessToken: token.accessToken, console: token.console }, activeSession);
      return await operation(freshClient);
    }
  };

  const eaLeagueId = Number(row.ea_league_id);
  const info = await runWithFreshSession((c) => c.getLeagueInfo(eaLeagueId));
  const seasonYear = info.careerHubInfo?.seasonInfo?.seasonYear ?? row.ea_season_year ?? new Date().getFullYear();
  const seasonInfo = info.careerHubInfo?.seasonInfo;
  const teamIdInfoList = info.teamIdInfoList ?? [];
  if (info.userAdminHubInfo?.userInfoMap != null) {
    await persistImportedEaUsernames(leagueId, eaUsernamesFromHub(info)).catch((error) =>
      console.error("[WARN] Failed to store imported EA gamertags (non-fatal):", error));
  }
  if (datasets.includes("rosters") && teamIdInfoList.length === 0) {
    throw new Error(
      "EA's league hub returned no teams for this franchise, so the roster import has nothing to fetch. " +
        "Reconnect from the Import Data window and try again.",
    );
  }

  // Weekly datasets follow the picker: current week, an explicit list, or all weeks through
  // current. Omitted weekRefs used to expand 0..current, so "Current week" imported history.
  const defaultWeekRef: EaWeekRef = options.stage !== undefined && options.weekIndex !== undefined
    ? { stageIndex: options.stage, weekIndex: options.weekIndex }
    : seasonInfo
      ? currentWeekFromSeasonInfo({ seasonWeek: seasonInfo.seasonWeek, seasonWeekType: seasonInfo.seasonWeekType })
      : { stageIndex: 1, weekIndex: 0 };
  const weeklyRefs = resolveWeeklyImportRefs({
    weekRefs: options.weekRefs,
    stage: options.stage,
    weekIndex: options.weekIndex,
    weekScope: options.weekScope,
    current: defaultWeekRef,
  });

  const results: EaImportResult[] = [];
  let scheduleImported = false;
  const importedPlayerIds = new Set<string>();

  // Save photo_url mapping before wipe — keyed by madden_player_id and full_name
  // so we can restore photos after the EA import creates new players.
  let photoByEaId = new Map<string, string>();
  let photoByName = new Map<string, string>();
  if (datasets.includes("rosters")) {
    const existingPhotos = await getPgPool().query<{ madden_player_id: string | null; full_name: string | null; photo_url: string }>(
      `select madden_player_id, full_name, photo_url from rec_players where league_id=$1 and photo_url is not null and photo_url != ''`,
      [leagueId],
    );
    for (const p of existingPhotos.rows) {
      if (p.madden_player_id) photoByEaId.set(p.madden_player_id, p.photo_url);
      if (p.full_name) photoByName.set(p.full_name.toLowerCase(), p.photo_url);
    }
    console.log(`[EA] Saved ${photoByEaId.size} photos by EA ID, ${photoByName.size} by name for photo restore.`);
  }

  // Fetch rosters before writing so an empty EA response never reconciles against a blank
  // id list (that would delete every player). We do not wipe the existing roster first —
  // each import upserts/moves/updates, then drops anyone not in this EA payload, including
  // leftover seeds and placeholders.
  const rosterWeekLabel = describeEaWeek(defaultWeekRef.stageIndex, defaultWeekRef.weekIndex).label;
  const emitRosterTeam = (team: { name: string; index: number; total: number }) => {
    pushProgress(leagueId, {
      type: "step",
      step: team.index + 1,
      stepCount: team.total,
      label: `Importing Rosters for ${rosterWeekLabel}`,
      detail: team.name,
    });
  };

  let preloadedRosterRaw: unknown | null = null;
  let preloadedFaRaw: unknown | null = null;
  if (datasets.includes("rosters") || datasets.includes("free_agents")) {
    pushProgress(leagueId, { type: "reconciling", step: "Checking EA roster…" });
    const rosterPromise = datasets.includes("rosters")
      ? runWithFreshSession((c) => fetchDataset(c, "rosters", eaLeagueId, defaultWeekRef, teamIdInfoList, emitRosterTeam))
      : null;
    const faPromise = datasets.includes("free_agents")
      ? runWithFreshSession((c) => fetchDataset(c, "free_agents", eaLeagueId, defaultWeekRef, teamIdInfoList))
      : null;
    if (rosterPromise) {
      preloadedRosterRaw = await rosterPromise;
      const preloadedCount = extractEaRows(preloadedRosterRaw, "rosterInfoList").length;
      if (preloadedCount === 0) {
        const shape = Array.isArray(preloadedRosterRaw)
          ? `array(len=${preloadedRosterRaw.length})`
          : preloadedRosterRaw && typeof preloadedRosterRaw === "object"
            ? `object keys=${Object.keys(preloadedRosterRaw as object).slice(0, 12).join(",")}`
            : String(preloadedRosterRaw);
        console.error(`[EA] Empty roster payload shape: ${shape}; teams=${teamIdInfoList.length}`);
        throw new Error(
          "EA returned an empty roster for this franchise. Existing players were left unchanged. This usually means the EA " +
            "session needs to be reconnected — try again, and reconnect from the Import Data window if it keeps failing.",
        );
      }
    }
    if (faPromise) preloadedFaRaw = await faPromise;
  }

  pushProgress(leagueId, { type: "starting", datasets: datasets.map(String), weeks: weeklyRefs.length });

  const writeImportedDataset = async (dataset: EaDataset, raw: unknown, week: EaWeekRef) => {
    const isWeekly = WEEKLY_DATASETS.has(dataset);
    const weekDesc = describeEaWeek(week.stageIndex, week.weekIndex);
    const label = isWeekly
      ? `${EA_DATASET_LABELS[dataset]} — ${weekDesc.label}`
      : EA_DATASET_LABELS[dataset];
    let records = 0;

    if (dataset === "schedule") {
      records = await directWriteSchedule(leagueId, raw, weekDesc.displayWeek, weekDesc.phase);
      scheduleImported = true;
    } else if (dataset === "rosters") {
      const roster = await directWriteRoster(leagueId, raw, false);
      collectImportedPlayerIds(raw, importedPlayerIds);
      return { dataset, label, records: roster.records, duplicate: roster.duplicate };
    } else if (dataset === "free_agents") {
      const roster = await directWriteRoster(leagueId, raw, true);
      collectImportedPlayerIds(raw, importedPlayerIds);
      return { dataset, label, records: roster.records, duplicate: roster.duplicate };
    } else {
      const envelope = toIngestEnvelope({ dataset, raw, eaLeagueId, seasonYear, stage: week.stageIndex, weekIndex: week.weekIndex });
      const ingested = await ingestCompanionPayload(direct, envelope.endpointKey, envelope.payload, { "x-rec-ea-direct": "1" }, "madden_direct_sync");
      records = ingested.records_stored;
    }
    return { dataset, label, records, duplicate: false };
  };

  const importDatasetAtWeek = async (dataset: EaDataset, week: EaWeekRef) => {
    const isWeekly = WEEKLY_DATASETS.has(dataset);
    const weekDesc = describeEaWeek(week.stageIndex, week.weekIndex);
    const scope = isWeekly ? weekDesc.label : "league-wide snapshot";
    const t0 = Date.now();
    console.log(`[EA] Fetching ${dataset} (${scope})...`);
    const raw = dataset === "rosters" && preloadedRosterRaw && week.stageIndex === defaultWeekRef.stageIndex && week.weekIndex === defaultWeekRef.weekIndex
      ? preloadedRosterRaw
      : dataset === "free_agents" && preloadedFaRaw
        ? preloadedFaRaw
        : await runWithFreshSession((c) => fetchDataset(c, dataset, eaLeagueId, week, teamIdInfoList, dataset === "rosters" ? emitRosterTeam : undefined));
    console.log(`[EA] Fetched ${dataset} (${scope}) in ${Date.now() - t0}ms`);
    return writeImportedDataset(dataset, raw, week);
  };

  // Split datasets into snapshot (no week) and weekly types
  const snapshotDatasets = datasets.filter((d) => !WEEKLY_DATASETS.has(d));
  const weeklyDatasets = datasets.filter((d) => WEEKLY_DATASETS.has(d));

  // Snapshot datasets: fetch in parallel, EXCEPT rosters and free_agents which both write
  // rec_players keyed on (league_id, madden_player_id) — a player who straddles both exports
  // (just released, still lingering in one list) let two concurrent upserts for the same key
  // race each other and crashed with "duplicate key value violates unique constraint
  // rec_players_league_id_madden_player_id_key". Those two run sequentially against each
  // other; teams/standings don't touch rec_players and stay parallel with everything.
  const rosterLikeDatasets = snapshotDatasets.filter((d) => d === "rosters" || d === "free_agents");
  const otherSnapshotDatasets = snapshotDatasets.filter((d) => d !== "rosters" && d !== "free_agents");
  if (snapshotDatasets.length > 0) {
    pushProgress(leagueId, { type: "dataset_start", dataset: "snapshots", label: `Fetching ${snapshotDatasets.map((d) => EA_DATASET_LABELS[d]).join(", ")}…` });
    const runOne = async (dataset: EaDataset) => {
      const result = await importDatasetAtWeek(dataset, defaultWeekRef);
      results.push({ dataset, label: result.label, importJobId: null, duplicate: result.duplicate, recordsStored: result.records });
      pushProgress(leagueId, { type: "dataset_done", dataset: String(dataset), label: result.label, records: result.records, duplicate: result.duplicate });
    };
    const runSequentially = async (list: EaDataset[]) => {
      for (const dataset of list) {
        try {
          await runOne(dataset);
        } catch (error) {
          pushProgress(leagueId, { type: "dataset_error", dataset: String(dataset), label: EA_DATASET_LABELS[dataset], error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    await Promise.all([
      ...otherSnapshotDatasets.map((dataset) => runOne(dataset).catch((error) =>
        pushProgress(leagueId, { type: "dataset_error", dataset: String(dataset), label: EA_DATASET_LABELS[dataset], error: error instanceof Error ? error.message : String(error) }))),
      runSequentially(rosterLikeDatasets),
    ]);
  }

  // Weekly datasets: snallabot fetches two weeks at a time with every endpoint in
  // parallel (up to 16 Blaze calls). sendExport retries ERR_TIMEOUT / MCA_ERR_SERVER_ERROR
  // and hung sockets, so matching that batching is safe for a week-1-through-current import.
  if (weeklyDatasets.length > 0 && weeklyRefs.length > 0) {
    const weekBatches = chunkItems(weeklyRefs, EA_WEEKLY_WEEK_BATCH);
    let weeksCompleted = 0;
    for (const weekBatch of weekBatches) {
      const batchLabel = weekBatch.map((week) => describeEaWeek(week.stageIndex, week.weekIndex).label).join(", ");
      pushProgress(leagueId, { type: "dataset_start", dataset: "weekly", label: `Fetching ${weeklyDatasets.length} datasets for ${batchLabel} (${weeksCompleted + 1}–${weeksCompleted + weekBatch.length} of ${weeklyRefs.length})` });

      const fetched = await Promise.all(weekBatch.flatMap((week) => {
        const weekDesc = describeEaWeek(week.stageIndex, week.weekIndex);
        return weeklyDatasets.map(async (dataset) => {
          try {
            const raw = await runWithFreshSession((client) =>
              fetchDataset(client, dataset, eaLeagueId, week, teamIdInfoList),
            );
            return { week, dataset, raw, ok: true as const };
          } catch (error) {
            pushProgress(leagueId, {
              type: "dataset_error",
              dataset: String(dataset),
              label: `${EA_DATASET_LABELS[dataset]} — ${weekDesc.label}`,
              error: error instanceof Error ? error.message : String(error),
            });
            return { week, dataset, raw: null, ok: false as const };
          }
        });
      }));

      for (const [batchIndex, week] of weekBatch.entries()) {
        const weekDesc = describeEaWeek(week.stageIndex, week.weekIndex);
        const weekOrdinal = weeksCompleted + batchIndex;
        const weekItems = weeklyWriteOrder(
          fetched.filter((item) => item.ok && item.week.stageIndex === week.stageIndex && item.week.weekIndex === week.weekIndex),
        );
        for (const item of weekItems) {
          if (!item.ok || item.raw === null) continue;
          try {
            pushProgress(leagueId, {
              type: "step",
              step: weekOrdinal + 1,
              stepCount: weeklyRefs.length,
              label: `Saving ${weekDesc.label}`,
              detail: EA_DATASET_LABELS[item.dataset],
            });
            const result = await writeImportedDataset(item.dataset, item.raw, week);
            results.push({ dataset: item.dataset, label: result.label, importJobId: null, duplicate: result.duplicate, recordsStored: result.records });
            pushProgress(leagueId, { type: "dataset_done", dataset: String(item.dataset), label: result.label, records: result.records, duplicate: result.duplicate });
          } catch (error) {
            pushProgress(leagueId, { type: "dataset_error", dataset: String(item.dataset), label: `${EA_DATASET_LABELS[item.dataset]} — ${weekDesc.label}`, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      weeksCompleted += weekBatch.length;
    }
  }

  // Sync schedule results and trigger wager settlement checks
  if (scheduleImported) {
    pushProgress(leagueId, { type: "reconciling", step: "Syncing game results…" });
    // Also rebuilds rec_league_user_records/rec_season_user_records/rec_global_user_records
    // from the freshly-synced results — see the rebuild call inside
    // syncCompanionScheduleResultsIntoGameResults itself.
    await syncCompanionScheduleResultsIntoGameResults(leagueId).catch((error) =>
      console.error("[WARN] Failed to sync EA schedule results into rec_game_results (non-fatal):", error));
    pushProgress(leagueId, { type: "reconciling", step: "Recalculating records…" });
    try {
      const { refreshLeagueRecordHolders } = await import("../league-records/league-records.service.js");
      await refreshLeagueRecordHolders(leagueId);
    } catch (error) {
      console.error("[WARN] Failed to refresh league record holders after EA import (non-fatal):", error);
    }
    // Trigger wager inbox notifications for any wagers that now have results
    try {
      const { listConfirmableWagers } = await import("../wagers/wagers.service.js");
      const confirmable = await listConfirmableWagers(leagueId);
      if (confirmable.wagers.length > 0) console.log(`[EA] ${confirmable.wagers.length} wager(s) now confirmable after import.`);
    } catch (error) {
      console.error("[WARN] Failed to check confirmable wagers after import (non-fatal):", error);
    }
  }
  // Process badges/stories for games that now have team_stats from the import.
  if (datasets.includes("team_stats") || datasets.includes("schedule")) {
    pushProgress(leagueId, { type: "reconciling", step: "Processing headlines…" });
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
  // Cross-reference DB rosters with this import: drop players EA no longer lists.
  // Moves and rating updates already happened in directWriteRoster (upsert by EA id).
  if (datasets.includes("rosters") && importedPlayerIds.size > 0) {
    pushProgress(leagueId, { type: "reconciling", step: "Reconciling rosters…" });
    await reconcileRostersToImport(leagueId, [...importedPlayerIds]).catch((error) =>
      console.error("[WARN] Failed to reconcile rosters against the EA import (non-fatal):", error));
  }
  // Match pending custom-player/legend purchases to the new imported players by name.
  if (datasets.includes("rosters")) {
    pushProgress(leagueId, { type: "reconciling", step: "Linking pending purchases to imported players…" });
    const matched = await reconcilePendingPurchasesToImport(leagueId).catch((error) => {
      console.error("[WARN] Failed to reconcile pending purchases to import (non-fatal):", error);
      return 0;
    });
    if (matched > 0) console.log(`[EA] Matched ${matched} pending purchase(s) to imported players.`);

    // Legend/custom-player purchases are approved but deferred for Madden — the commissioner
    // recreates the player in the actual save, and this import is what makes it real. Detect
    // that and mark the purchase fulfilled.
    pushProgress(leagueId, { type: "reconciling", step: "Checking approved legends & custom players…" });
    const fulfilled = await reconcileApprovedMaddenPurchases(leagueId).catch((error) => {
      console.error("[WARN] Failed to reconcile approved Madden purchases (non-fatal):", error);
      return { legendsFulfilled: 0, customPlayersApplied: 0 };
    });
    if (fulfilled.legendsFulfilled > 0 || fulfilled.customPlayersApplied > 0) {
      console.log(`[EA] Fulfilled ${fulfilled.legendsFulfilled} legend(s), applied ${fulfilled.customPlayersApplied} custom player(s) from this import.`);
    }

    // Restore player photos from the saved mapping (by EA ID first, then by name)
    if (photoByEaId.size > 0 || photoByName.size > 0) {
      pushProgress(leagueId, { type: "reconciling", step: "Restoring player photos…" });
      const restored = await restorePlayerPhotos(leagueId, photoByEaId, photoByName);
      if (restored > 0) console.log(`[EA] Restored ${restored} player photo(s).`);
    }
  }
  await getPgPool().query(
    `update rec_ea_connections set status='active', last_error=null, last_import_at=now(), updated_at=now() where id=$1`,
    [connectionId],
  );
  pushProgress(leagueId, { type: "done", results });
  return results;
}

/**
 * Periodic auto-import sweep — the reason snallabot-style tools never see EA's ten-day-inactivity
 * refresh_token expiry is that they touch every connected league's session on a schedule instead
 * of waiting for a commissioner to click "Import Now." Wired into apps/api/src/index.ts on an
 * interval; each connection with auto_import enabled gets refreshed and re-imported in turn. Runs
 * connections sequentially (not in parallel) to stay gentle on both EA's API and this DB.
 * After a successful pull, Pending Items gets a confirmation of scores, stats, or player movement.
 */
/** Persists a failed import's error onto the connection row so it's visible outside the live progress stream (e.g. after the commissioner's modal is closed). */
export async function recordEaImportError(connectionId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await getPgPool().query(
    `update rec_ea_connections set last_error=$2, updated_at=now() where id=$1`,
    [connectionId, message.slice(0, 500)],
  ).catch(() => undefined);
}

export async function runAutoImportSweep(): Promise<{ attempted: number; succeeded: number; failed: number }> {
  if (!isEaImportConfigured()) return { attempted: 0, succeeded: 0, failed: 0 };
  const rows = await getPgPool().query<EaConnectionRow>(
    `select * from rec_ea_connections where auto_import=true and status='active' and ea_league_id is not null`,
  );
  let succeeded = 0;
  let failed = 0;
  for (const row of rows.rows) {
    if (getImportProgress(row.league_id).running) {
      console.log(`[EA] Auto-import sweep: skipping league ${row.league_id} — an import is already running.`);
      continue;
    }
    beginImportProgress(row.league_id, "auto");
    try {
      const { snapshotImportState, describeImportChanges, notifyCommissionersOfAutoImport } = await import("./ea-auto-import-notify.js");
      const before = await snapshotImportState(row.league_id);
      await importEaDatasetsWithProgress(row.id, row.league_id, { weekScope: "current" });
      const after = await snapshotImportState(row.league_id);
      const notes = describeImportChanges(before, after);
      if (notes.length) await notifyCommissionersOfAutoImport(row.league_id, notes);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EA] Auto-import sweep failed for league ${row.league_id}:`, message);
      pushProgress(row.league_id, { type: "error", error: message });
      await recordEaImportError(row.id, error);
    }
  }
  return { attempted: rows.rows.length, succeeded, failed };
}

/** Backward-compatible wrapper — callers that don't need progress events. */
export async function importEaDatasets(connectionId: string, leagueId: string, options: EaImportOptions = {}): Promise<EaImportResult[]> {
  return importEaDatasetsWithProgress(connectionId, leagueId, options);
}

/**
 * Wipe ALL players for a league so the EA import becomes the sole source of truth.
 * Every player exists in-game and will be re-imported from EA.
 */
export async function wipeBaselineRoster(leagueId: string): Promise<number> {
  const count = await getPgPool().query<{ id: string }>(
    `select id from rec_players where league_id=$1`,
    [leagueId],
  );
  if (!count.rows.length) return 0;
  try {
    await getPgPool().query(`delete from rec_players where league_id=$1`, [leagueId]);
    return count.rows.length;
  } catch {
    await getPgPool().query(
      `update rec_players set roster_status='removed', updated_at=now() where league_id=$1`,
      [leagueId],
    );
    return count.rows.length;
  }
}

/**
 * Restore player photos after an EA import. Matches by madden_player_id first (exact),
 * then falls back to full_name (case-insensitive) for baseline players that didn't have
 * an EA ID when the photo was uploaded.
 */
async function restorePlayerPhotos(
  leagueId: string,
  photoByEaId: Map<string, string>,
  photoByName: Map<string, string>,
): Promise<number> {
  if (photoByEaId.size === 0 && photoByName.size === 0) return 0;

  const pool = getPgPool();
  const players = await pool.query<{ id: string; madden_player_id: string | null; full_name: string }>(
    `select id, madden_player_id, full_name from rec_players where league_id=$1 and (photo_url is null or photo_url = '')`,
    [leagueId],
  );

  // Build CASE expressions for a single batched UPDATE
  const eaCases: string[] = [];
  const nameCases: string[] = [];
  const eaIds: string[] = [];
  const names: string[] = [];
  const params: string[] = [leagueId];
  let paramIdx = 2;

  for (const player of players.rows) {
    const photo = (player.madden_player_id && photoByEaId.get(player.madden_player_id))
      ?? photoByName.get(player.full_name?.toLowerCase() ?? "");
    if (!photo) continue;

    if (player.madden_player_id && photoByEaId.get(player.madden_player_id)) {
      eaCases.push(`when madden_player_id = $${paramIdx} then $${paramIdx + 1}`);
      eaIds.push(player.madden_player_id);
      params.push(player.madden_player_id, photo);
      paramIdx += 2;
    } else {
      nameCases.push(`when lower(full_name) = $${paramIdx} then $${paramIdx + 1}`);
      names.push(player.full_name?.toLowerCase() ?? "");
      params.push(player.full_name?.toLowerCase() ?? "", photo);
      paramIdx += 2;
    }
  }

  if (eaCases.length === 0 && nameCases.length === 0) return 0;

  const wheres: string[] = [];
  if (eaCases.length > 0) wheres.push(`(madden_player_id in (${eaIds.map((_, i) => `$${2 + i * 2}`).join(",")}))`);
  if (nameCases.length > 0) wheres.push(`(lower(full_name) in (${names.map((_, i) => `$${2 + eaIds.length * 2 + i * 2}`).join(",")}))`);

  // Simpler approach: just do a single pass with a CTE
  // Actually, let's just use a simpler batched approach
  let restored = 0;
  const batchSize = 50;
  for (let i = 0; i < players.rows.length; i += batchSize) {
    const batch = players.rows.slice(i, i + batchSize);
    const updates: Array<{ id: string; photo: string }> = [];
    for (const player of batch) {
      const photo = (player.madden_player_id && photoByEaId.get(player.madden_player_id))
        ?? photoByName.get(player.full_name?.toLowerCase() ?? "");
      if (photo) updates.push({ id: player.id, photo });
    }
    if (updates.length === 0) continue;
    const cases = updates.map((u, idx) => `when id = $${idx * 2 + 2} then $${idx * 2 + 3}`).join(" ");
    const ids = updates.map((u) => u.id);
    const flatParams = updates.flatMap((u) => [u.id, u.photo]);
    await pool.query(
      `update rec_players set photo_url = case ${cases} end where id = any($1::uuid[])`,
      [ids, ...flatParams],
    );
    restored += updates.length;
  }
  return restored;
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
 * from the imported rows are removed — including leftover baseline seeds, name placeholders,
 * and legend/custom rows that have not appeared in this save. Imported rows themselves already
 * upserted by madden_player_id (ratings, team moves, free-agent flags). A hard delete can trip
 * NO ACTION foreign keys (award nominees, fantasy draft picks); those rows fall back to
 * roster_status='removed' so they leave the active roster either way.
 */
async function reconcileRostersToImport(leagueId: string, importedPlayerIds: string[]): Promise<void> {
  const imported = new Set(importedPlayerIds);
  const existing = await getPgPool().query<{
    id: string;
    madden_player_id: string | null;
    player_source: string | null;
  }>(
    `select p.id, p.madden_player_id, p.player_source
       from rec_players p
      where p.league_id=$1`,
    [leagueId],
  );
  const staleIds = existing.rows
    .filter((row) => !shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: row.madden_player_id, playerSource: row.player_source, isCustomBuild: false },
      imported,
    ))
    .map((row) => row.id);
  if (!staleIds.length) return;
  try {
    await getPgPool().query(`delete from rec_players where league_id=$1 and id = any($2::uuid[])`, [leagueId, staleIds]);
    console.log(`[EA] Roster reconciliation: removed ${staleIds.length} stale player(s) not present in the EA import.`);
  } catch (error) {
    await getPgPool().query(
      `update rec_players set roster_status='removed', updated_at=now() where league_id=$1 and id = any($2::uuid[])`,
      [leagueId, staleIds],
    );
    console.warn(`[EA] Roster reconciliation: marked ${staleIds.length} stale player(s) removed (blocked by references):`, error instanceof Error ? error.message : error);
  }
}

function fetchDataset(
  client: ReturnType<typeof createEaClient>,
  dataset: EaDataset,
  eaLeagueId: number,
  week: EaWeekRef,
  teamIdInfoList: Array<{ teamId: number; displayName: string; shortName: string; presentationId: number }>,
  onRosterTeam?: (info: { name: string; index: number; total: number }) => void,
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
    case "rosters": return fetchAllTeamRosters(client, eaLeagueId, teamIdInfoList, onRosterTeam);
    case "free_agents": return client.getFreeAgents(eaLeagueId);
  }
}

async function persistImportedEaUsernames(leagueId: string, names: Map<string, string>): Promise<void> {
  const pool = getPgPool();
  await pool.query(`update rec_teams set ea_username=null, updated_at=now() where league_id=$1`, [leagueId]);
  for (const [maddenTeamId, username] of names) {
    await pool.query(
      `update rec_teams set ea_username=$3, updated_at=now() where league_id=$1 and madden_team_id=$2`,
      [leagueId, maddenTeamId, username],
    );
  }
  if (names.size > 0) console.log(`[EA] Stored ${names.size} imported console gamertag(s).`);
}

async function fetchAllTeamRosters(
  client: ReturnType<typeof createEaClient>,
  eaLeagueId: number,
  teamIdInfoList: Array<{ teamId: number; displayName: string; shortName: string; presentationId: number }>,
  onTeam?: (info: { name: string; index: number; total: number }) => void,
): Promise<{ rosterInfoList: Array<Record<string, unknown>> }> {
  // Snallabot leaves each team's export in companion envelope shape
  // (`{ rosterInfoList, success, message }`) and posts them separately. We concatenate every
  // team's players into one list, but MUST keep that envelope — a bare array is `typeof
  // "object"` with no `rosterInfoList` key, so extractEaRows / directWriteRoster both
  // treated a successful fetch as empty and aborted the first import.
  // Snallabot pulls 4 team rosters at a time. Sequential 32-team fetches were the slowest
  // snapshot step; batching here matches that without flooding EA the way an unbounded
  // Promise.all of every team would.
  const allRows: Array<Record<string, unknown>> = [];
  const indexed = teamIdInfoList.map((team, index) => ({ team, index }));
  for (const batch of chunkItems(indexed, EA_ROSTER_TEAM_BATCH)) {
    const parts = await Promise.all(batch.map(async ({ team, index }) => {
      onTeam?.({
        name: team.displayName || team.shortName || `Team ${team.teamId}`,
        index,
        total: teamIdInfoList.length,
      });
      const raw = await client.getTeamRoster(eaLeagueId, team.teamId, index);
      const rows = extractEaEnvelopeRows(raw, "rosterInfoList");
      for (const row of rows) {
        if (row.teamId === undefined) row.teamId = team.teamId;
      }
      return rows;
    }));
    for (const rows of parts) allRows.push(...rows);
  }
  console.log(`[EA] Combined ${allRows.length} roster player(s) from ${teamIdInfoList.length} team(s).`);
  return { rosterInfoList: allRows };
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
