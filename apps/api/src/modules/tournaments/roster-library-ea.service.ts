// EA Connect for roster libraries -- a parallel, trimmed copy of the league-scoped flow in
// ../madden-ea/ea-connections.service.ts, but keyed by library_id instead of league_id (a
// roster library has no Discord guild/league to piggyback on) and rosters-only (no schedule,
// no free agents, no companion-ingest side effects).
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import {
  BlazeSessionError,
  createBlazeSession,
  createEaClient,
  exchangeCodeForToken,
  extractAuthCode,
  getMaddenPersonas,
  getPersonaScopedToken,
} from "../madden-ea/ea-client.js";
import { EA_LOGIN_URL } from "../madden-ea/ea-constants.js";
import { requireEaImportConfigured } from "../madden-ea/ea-connections.service.js";
import { extractEaEnvelopeRows } from "../madden-ea/ea-datasets.js";
import { EA_RATING_TO_SNAKE, num, str } from "../madden-ea/ea-direct-writer.js";
import { chunkItems, EA_ROSTER_TEAM_BATCH } from "../madden-ea/ea-import-batches.js";
import {
  isTokenExpired,
  openToken,
  sealToken,
  type EaSessionCache,
  type EaTokenRecord,
} from "../madden-ea/ea-token-vault.js";
import { resolveTeamLoose } from "./roster-libraries.service.js";

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

type ConnectionRow = {
  id: string;
  library_id: string;
  blaze_persona_id: string;
  persona_display_name: string | null;
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
  status: string;
  last_error: string | null;
  last_import_at: string | null;
  created_at: string;
};

type PendingAuthRow = {
  id: string;
  library_id: string;
  requested_by_user_id: string | null;
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  personas: Array<Record<string, unknown>>;
  expires_at: string;
};

export type LibraryEaPersonaOption = {
  personaId: number;
  displayName: string;
  name: string;
  namespaceName: string;
  console: string;
};

export type LibraryEaConnectionSummary = {
  id: string;
  libraryId: string;
  console: string;
  personaDisplayName: string | null;
  eaLeagueId: string | null;
  eaLeagueName: string | null;
  eaSeasonYear: number | null;
  status: string;
  lastError: string | null;
  lastImportAt: string | null;
  createdAt: string;
};

export type LibraryEaFranchiseSummary = {
  leagueId: number;
  leagueName: string;
  calendarYear: number;
  numMembers: number;
  userTeamId: number;
  userTeamName: string;
  seasonText: string;
};

function toSummary(row: ConnectionRow): LibraryEaConnectionSummary {
  return {
    id: row.id,
    libraryId: row.library_id,
    console: row.console,
    personaDisplayName: row.persona_display_name,
    eaLeagueId: row.ea_league_id,
    eaLeagueName: row.ea_league_name,
    eaSeasonYear: row.ea_season_year,
    status: row.status,
    lastError: row.last_error,
    lastImportAt: row.last_import_at,
    createdAt: row.created_at,
  };
}

function openEaToken(row: Pick<ConnectionRow, "token_ciphertext" | "token_iv" | "token_tag">): EaTokenRecord {
  return openToken({ ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag });
}

async function updateSealedToken(connectionId: string, token: EaTokenRecord) {
  const sealed = sealToken(token);
  await getPgPool().query(
    `update rec_site_roster_library_ea_connections
        set token_ciphertext=$2, token_iv=$3, token_tag=$4,
            token_expires_at=to_timestamp($5 / 1000.0), last_refreshed_at=now(), status='active', updated_at=now()
      where id=$1`,
    [connectionId, sealed.ciphertext, sealed.iv, sealed.tag, token.expiresAt],
  );
}

async function refreshedToken(row: ConnectionRow): Promise<EaTokenRecord> {
  const current = openEaToken(row);
  if (!isTokenExpired(current)) return current;
  const { refreshEaToken } = await import("../madden-ea/ea-client.js");
  const refreshed = await refreshEaToken(current.refreshToken);
  const next: EaTokenRecord = { ...refreshed, console: current.console, blazePersonaId: current.blazePersonaId };
  await updateSealedToken(row.id, next);
  return next;
}

async function cachedSession(row: ConnectionRow): Promise<EaSessionCache | null> {
  if (!row.session_key || row.session_blaze_id == null) return null;
  return { blazeId: Number(row.session_blaze_id), sessionKey: row.session_key, requestId: row.session_request_id ?? 1 };
}

async function persistSession(connectionId: string, session: EaSessionCache) {
  await getPgPool().query(
    `update rec_site_roster_library_ea_connections set session_key=$2, session_blaze_id=$3, session_request_id=$4, updated_at=now() where id=$1`,
    [connectionId, session.sessionKey, session.blazeId, session.requestId],
  );
}

async function clearSession(connectionId: string) {
  await getPgPool().query(
    `update rec_site_roster_library_ea_connections set session_key=null, session_blaze_id=null, updated_at=now() where id=$1`,
    [connectionId],
  );
}

async function loadConnection(libraryId: string): Promise<ConnectionRow> {
  const result = await getPgPool().query<ConnectionRow>(
    `select * from rec_site_roster_library_ea_connections where library_id=$1`,
    [libraryId],
  );
  if (!result.rows[0]) throw new ApiError(404, "This roster library isn't connected to EA yet.");
  return result.rows[0];
}

async function recordImportError(connectionId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await getPgPool().query(
    `update rec_site_roster_library_ea_connections set last_error=$2, updated_at=now() where id=$1`,
    [connectionId, message.slice(0, 500)],
  ).catch(() => undefined);
}

/** Session that survives a stale-session retry once, mirroring ea-connections.service.ts's
 *  runWithFreshSession without the weekly-import keepalive loop (a rosters-only pull is short). */
async function withFreshSession<T>(
  row: ConnectionRow,
  token: EaTokenRecord,
  operation: (client: ReturnType<typeof createEaClient>) => Promise<T>,
): Promise<T> {
  const existing = await cachedSession(row);
  const session = existing ?? await createBlazeSession(token.accessToken, token.console);
  if (!existing) await persistSession(row.id, session);
  try {
    return await operation(createEaClient({ accessToken: token.accessToken, console: token.console }, session));
  } catch (error) {
    if (!(error instanceof BlazeSessionError)) throw error;
    await clearSession(row.id);
    const fresh = await createBlazeSession(token.accessToken, token.console);
    await persistSession(row.id, fresh);
    return await operation(createEaClient({ accessToken: token.accessToken, console: token.console }, fresh));
  }
}

export async function beginLibraryEaLogin(libraryId: string, recUserId: string): Promise<{ loginUrl: string; expiresInSeconds: number }> {
  requireEaImportConfigured();
  await getPgPool().query("delete from rec_site_roster_library_ea_pending_auth where library_id=$1 and expires_at < now()", [libraryId]);
  return { loginUrl: EA_LOGIN_URL, expiresInSeconds: Math.floor(PENDING_AUTH_TTL_MS / 1000) };
}

export async function submitLibraryEaCode(
  libraryId: string,
  recUserId: string,
  pasted: string,
): Promise<{ pendingAuthId: string; personas: LibraryEaPersonaOption[] }> {
  requireEaImportConfigured();
  const code = extractAuthCode(pasted);
  const temporary = await exchangeCodeForToken(code);
  const { personas: maddenPersonas } = await getMaddenPersonas(temporary.access_token);
  if (maddenPersonas.length === 0) {
    throw new ApiError(422, "This EA account has no Madden gamertag on a supported platform.");
  }
  const personas: LibraryEaPersonaOption[] = maddenPersonas.map((persona) => ({
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
    `insert into rec_site_roster_library_ea_pending_auth (library_id, requested_by_user_id, token_ciphertext, token_iv, token_tag, personas, expires_at)
     values ($1,$2,$3,$4,$5,$6::jsonb, now() + $7::interval)
     returning id, library_id, requested_by_user_id, token_ciphertext, token_iv, token_tag, personas, expires_at`,
    [libraryId, recUserId, sealed.ciphertext, sealed.iv, sealed.tag, JSON.stringify(personas), `${PENDING_AUTH_TTL_MS} milliseconds`],
  );
  const pending = result.rows[0];
  return { pendingAuthId: pending.id, personas };
}

export async function selectLibraryEaPersona(
  libraryId: string,
  recUserId: string,
  pendingAuthId: string,
  personaId: number,
): Promise<LibraryEaConnectionSummary> {
  requireEaImportConfigured();
  const pendingResult = await getPgPool().query<PendingAuthRow>(
    `select * from rec_site_roster_library_ea_pending_auth where id=$1 and library_id=$2`,
    [pendingAuthId, libraryId],
  );
  const pending = pendingResult.rows[0];
  if (!pending) throw new ApiError(404, "Pending EA login not found for this library.");
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await getPgPool().query("delete from rec_site_roster_library_ea_pending_auth where id=$1", [pending.id]);
    throw new ApiError(410, "That EA login has expired. Start a new login and paste a fresh URL.");
  }
  const persona = (pending.personas ?? []).find((p) => Number(p.personaId) === Number(personaId)) as LibraryEaPersonaOption | undefined;
  if (!persona) throw new ApiError(422, "That gamertag is not part of this login.");
  if (!["xone", "ps4", "pc", "ps5", "xbsx", "stadia"].includes(persona.console)) {
    throw new ApiError(422, "Unsupported console for that gamertag.");
  }

  const temporary = openEaToken({ token_ciphertext: pending.token_ciphertext, token_iv: pending.token_iv, token_tag: pending.token_tag });
  const personaToken = await getPersonaScopedToken(temporary.accessToken, persona.personaId, persona.namespaceName as "xbox" | "ps3" | "cem_ea_id" | "stadia");
  const sealed = sealToken({
    ...personaToken,
    console: persona.console as EaTokenRecord["console"],
    blazePersonaId: String(persona.personaId),
  });

  const result = await getPgPool().query<ConnectionRow>(
    `insert into rec_site_roster_library_ea_connections
       (library_id, blaze_persona_id, persona_display_name, console,
        token_ciphertext, token_iv, token_tag, token_expires_at, connected_by_user_id)
     values ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0),$9)
     on conflict (library_id) do update set
       blaze_persona_id=excluded.blaze_persona_id, persona_display_name=excluded.persona_display_name,
       console=excluded.console, token_ciphertext=excluded.token_ciphertext, token_iv=excluded.token_iv,
       token_tag=excluded.token_tag, token_expires_at=excluded.token_expires_at,
       session_key=null, session_blaze_id=null, ea_league_id=null, ea_league_name=null,
       ea_season_year=null, status='active', last_error=null, connected_by_user_id=excluded.connected_by_user_id,
       updated_at=now()
     returning *`,
    [libraryId, String(persona.personaId), persona.displayName, persona.console,
      sealed.ciphertext, sealed.iv, sealed.tag, personaToken.expiresAt, recUserId],
  );
  await getPgPool().query("delete from rec_site_roster_library_ea_pending_auth where id=$1", [pending.id]);
  return toSummary(result.rows[0]);
}

export async function getLibraryEaConnectionStatus(libraryId: string): Promise<{ connection: LibraryEaConnectionSummary | null }> {
  try {
    const result = await getPgPool().query<ConnectionRow>(
      `select * from rec_site_roster_library_ea_connections where library_id=$1`,
      [libraryId],
    );
    return { connection: result.rows[0] ? toSummary(result.rows[0]) : null };
  } catch (error) {
    console.error("[EA] getLibraryEaConnectionStatus failed:", error);
    return { connection: null };
  }
}

export async function listLibraryEaLeagues(libraryId: string): Promise<LibraryEaFranchiseSummary[]> {
  requireEaImportConfigured();
  const row = await loadConnection(libraryId);
  const token = await refreshedToken(row);
  try {
    return await withFreshSession(row, token, async (client) => {
      const leagues = await client.getLeagues();
      return leagues.map((league) => ({
        leagueId: league.leagueId, leagueName: league.leagueName, calendarYear: league.calendarYear,
        numMembers: league.numMembers, userTeamId: league.userTeamId, userTeamName: league.userTeamName,
        seasonText: league.seasonText,
      }));
    });
  } catch (error) {
    await recordImportError(row.id, error);
    throw error;
  }
}

export async function bindLibraryEaLeague(libraryId: string, eaLeagueId: number): Promise<LibraryEaConnectionSummary> {
  requireEaImportConfigured();
  const row = await loadConnection(libraryId);
  const token = await refreshedToken(row);
  try {
    const info = await withFreshSession(row, token, (client) => client.getLeagueInfo(eaLeagueId));
    if (!info.success) throw new ApiError(422, `EA rejected that franchise: ${info.message ?? "unknown error"}`);
    const seasonYear = info.careerHubInfo?.seasonInfo?.seasonYear ?? null;
    const result = await getPgPool().query<ConnectionRow>(
      `update rec_site_roster_library_ea_connections set ea_league_id=$2, ea_league_name=$3, ea_season_year=$4, status='active', updated_at=now() where id=$1 returning *`,
      [row.id, String(eaLeagueId), info.careerHubInfo?.seasonInfo?.seasonTitle ?? null, seasonYear],
    );
    return toSummary(result.rows[0]);
  } catch (error) {
    await recordImportError(row.id, error);
    throw error;
  }
}

export async function importLibraryRosters(input: { libraryId: string }): Promise<{ imported: number; skipped: Array<{ team: string; reason: string }> }> {
  requireEaImportConfigured();
  const row = await loadConnection(input.libraryId);
  if (!row.ea_league_id) throw new ApiError(409, "No EA franchise is bound to this library yet. Choose a franchise first.");
  const library = await getPgPool().query<{ game: string }>(`select game from rec_site_roster_libraries where id=$1`, [input.libraryId]);
  const game = library.rows[0]?.game;
  if (!game) throw new ApiError(404, "Roster library not found.");

  const token = await refreshedToken(row);
  const eaLeagueId = Number(row.ea_league_id);
  let info: Awaited<ReturnType<ReturnType<typeof createEaClient>["getLeagueInfo"]>>;
  try {
    info = await withFreshSession(row, token, (client) => client.getLeagueInfo(eaLeagueId));
  } catch (error) {
    await recordImportError(row.id, error);
    throw error;
  }
  const teamIdInfoList = info.teamIdInfoList ?? [];
  if (!teamIdInfoList.length) {
    throw new ApiError(422, "EA's league hub returned no teams for this franchise. Reconnect and try again.");
  }

  const skipped: Array<{ team: string; reason: string }> = [];
  const teamByEaId = new Map<number, { abbr: string; name: string }>();
  for (const team of teamIdInfoList) {
    const resolved = resolveTeamLoose(game, team.displayName) ?? resolveTeamLoose(game, team.shortName);
    if (!resolved) {
      skipped.push({ team: team.displayName || team.shortName || String(team.teamId), reason: "Could not match to a known team." });
      continue;
    }
    teamByEaId.set(team.teamId, resolved);
  }

  const indexed = teamIdInfoList.map((team, index) => ({ team, index }));
  const players: Array<{
    team_abbr: string; team_name: string; full_name: string; position: string | null;
    jersey_number: number | null; overall_rating: number | null; attributes: Record<string, number>;
  }> = [];

  try {
    await withFreshSession(row, token, async (client) => {
      for (const batch of chunkItems(indexed, EA_ROSTER_TEAM_BATCH)) {
        await Promise.all(batch.map(async ({ team, index }) => {
          const resolved = teamByEaId.get(team.teamId);
          if (!resolved) return;
          const raw = await client.getTeamRoster(eaLeagueId, team.teamId, index);
          const rows = extractEaEnvelopeRows(raw, "rosterInfoList");
          for (const playerRow of rows) {
            const firstName = str(playerRow, ["firstName", "first_name"]);
            const lastName = str(playerRow, ["lastName", "last_name"]);
            const fullName = str(playerRow, ["fullName", "full_name", "displayName", "playerName"])
              ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
            if (!fullName) continue;
            const attrs: Record<string, number> = {};
            for (const [key, val] of Object.entries(playerRow)) {
              if (typeof val === "number" && EA_RATING_TO_SNAKE[key]) attrs[EA_RATING_TO_SNAKE[key]] = val;
            }
            players.push({
              team_abbr: resolved.abbr,
              team_name: resolved.name,
              full_name: fullName,
              position: str(playerRow, ["position", "positionName", "positionAbbr"]),
              jersey_number: num(playerRow, ["jerseyNum", "jerseyNumber", "jersey_number"]),
              overall_rating: num(playerRow, ["playerBestOvr", "overallRating", "overall", "ovrRating", "ovr"]),
              attributes: attrs,
            });
          }
        }));
      }
    });
  } catch (error) {
    await recordImportError(row.id, error);
    throw error;
  }

  if (!players.length) throw new ApiError(422, "EA returned no roster players for this franchise.");

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`delete from rec_site_roster_library_players where library_id = $1`, [input.libraryId]);
    const chunkSize = 200;
    for (let i = 0; i < players.length; i += chunkSize) {
      const chunk = players.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((p, idx) => {
        const base = idx * 8;
        values.push(input.libraryId, p.team_abbr, p.team_name, p.full_name, p.position, p.jersey_number, p.overall_rating, JSON.stringify(p.attributes));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb)`;
      }).join(", ");
      await client.query(
        `insert into rec_site_roster_library_players
           (library_id, team_abbr, team_name, full_name, position, jersey_number, overall_rating, attributes)
         values ${placeholders}`,
        values,
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await getPgPool().query(
    `update rec_site_roster_library_ea_connections set last_import_at=now(), last_error=null, updated_at=now() where id=$1`,
    [row.id],
  );
  return { imported: players.length, skipped };
}
