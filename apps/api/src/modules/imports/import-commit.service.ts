import { NFL_TEAMS, normalizeImportedStats } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { applyAdvanceRecords } from "../advance/advance.service.js";
import { getImportJob, updateImportJobStatus } from "./import.service.js";

// Canonical NFL conference/division alignment, keyed by normalized name and abbreviation, so imports
// resolve EA team variations (custom names, "AZ" vs "ARI") to correct conference/division regardless
// of what EA reports.
const canonicalTeamByAbbr = new Map(NFL_TEAMS.map((t) => [t.abbreviation.toUpperCase(), t]));
const canonicalTeamByName = new Map(NFL_TEAMS.map((t) => [t.name.toLowerCase().replace(/[^a-z0-9]/g, ""), t]));

function canonicalTeam(name: string | null | undefined, abbreviation: string | null | undefined) {
  const byAbbr = abbreviation ? canonicalTeamByAbbr.get(String(abbreviation).toUpperCase()) : undefined;
  if (byAbbr) return byAbbr;
  const key = name ? String(name).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return key ? canonicalTeamByName.get(key) : undefined;
}

type JsonObject = Record<string, unknown>;
type TeamRow = { id: string; name?: string | null; madden_team_id: string | null };
type AssignmentRow = { team_id: string; user_id: string | null };
type CommittedGameRow = { id: string; external_game_id: string | null; home_team_id: string | null; away_team_id: string | null; home_user_id: string | null; away_user_id: string | null; home_score: number | null; away_score: number | null; week_number: number | null; phase: string | null };

const SOURCE_TYPE = "madden_companion_export";
const RESULT_SOURCE = "ea_import";

function asObject(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function toNumber(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function toNullableInt(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.trunc(parsed) : null; }
function toNullableText(value: unknown) { if (value == null) return null; const text = String(value).trim(); return text.length ? text : null; }
function teamExternalId(row: any) { const raw = asObject(row.raw_payload); const normalized = asObject(row.normalized); return toNullableText(row.team_external_id ?? row.external_team_id ?? row.madden_team_id ?? normalized.teamId ?? raw.teamId ?? raw.id ?? raw.rosterId); }
function gameTeamExternalId(row: any, side: "home" | "away") { const raw = asObject(row.raw_payload); return toNullableText(side === "home" ? row.home_team_external_id ?? raw.homeTeamId ?? (asObject(raw.home).teamId) ?? (asObject(raw.seasonGameInfo).homeTeamId) : row.away_team_external_id ?? raw.awayTeamId ?? (asObject(raw.away).teamId) ?? (asObject(raw.seasonGameInfo).awayTeamId)); }
function normalizeTeamName(value: unknown, fallback: string) { const text = toNullableText(value); if (!text) return fallback; return /^\s*(Home|Away) Team \d+\s*$/i.test(text) ? fallback : text; }
function stagedTeamDisplayName(row: any) { const raw = asObject(row.raw_payload); const cityNick = [raw.cityName, raw.nickName].map(toNullableText).filter(Boolean).join(" "); return normalizeTeamName(cityNick || row.team_name || row.team_display_name || raw.displayName || raw.nickName || raw.abbrName, `Team ${teamExternalId(row) ?? "Unknown"}`); }
function normalizedLookup(value: unknown) { const text = toNullableText(value); return text ? text.toLowerCase().replace(/[^a-z0-9]/g, "") : null; }
function isFinalScore(homeScore: unknown, awayScore: unknown) { return homeScore != null && awayScore != null && Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore)); }
function gamePhase(weekNumber: number | null | undefined, seasonStage?: string | null) { if (seasonStage && seasonStage !== "regular_season") return seasonStage === "super_bowl" ? "playoffs" : seasonStage; if (!weekNumber || weekNumber <= 18) return "regular_season"; return "playoffs"; }
function gameStatus(row: any) { if (isFinalScore(row.home_score, row.away_score)) return "completed"; const status = String(row.game_status ?? "scheduled").toLowerCase(); return status === "complete" || status === "completed" ? "completed" : "scheduled"; }
function collectPrefixed(raw: JsonObject, suffixes: string[]) { const out: JsonObject = {}; for (const [key, value] of Object.entries(raw)) if (suffixes.some((suffix) => key.endsWith(suffix))) out[key] = value; return out; }
function buildRatings(raw: JsonObject) { return collectPrefixed(raw, ["Rating", "Grade"]); }
function buildTraits(raw: JsonObject) { return collectPrefixed(raw, ["Trait"]); }
function buildContract(raw: JsonObject) { const keys = ["capHit", "capReleaseNetSavings", "capReleasePenalty", "contractBonus", "contractSalary", "contractYearsLeft", "contractLength", "desiredBonus", "desiredSalary", "desiredLength", "reSignStatus"]; return Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]])); }
function sourceStatId(row: any, category: string) {
  const raw = asObject(row.raw_payload);
  const normalized = asObject(row.normalized);
  return toNullableText(row.source_stat_id ?? normalized.sourceStatId ?? raw.statId ?? raw.sourceStatId ?? raw.id)
    ?? `week:${row.week_number ?? "na"}:cat:${category}:player:${row.player_external_id ?? row.external_player_id ?? "na"}:team:${row.team_external_id ?? row.external_team_id ?? "na"}`;
}
function sourceScheduleId(row: any) {
  const raw = asObject(row.raw_payload);
  const normalized = asObject(row.normalized);
  return toNullableText(row.source_schedule_id ?? normalized.sourceScheduleId ?? raw.scheduleId ?? raw.sourceScheduleId ?? raw.gameId)
    ?? `week:${row.week_number ?? "na"}`;
}
function sourceInt(row: any, key: string) {
  const raw = asObject(row.raw_payload);
  const normalized = asObject(row.normalized);
  return toNullableInt((row as any)[key] ?? (normalized as any)[key] ?? (raw as any)[key]);
}
function sourceText(row: any, key: string) {
  const raw = asObject(row.raw_payload);
  const normalized = asObject(row.normalized);
  return toNullableText((row as any)[key] ?? (normalized as any)[key] ?? (raw as any)[key]);
}

// PostgREST caps every response at 1,000 rows and embeds .in() values in the request URL,
// so staged reads must be paged, value lists chunked, and bulk writes batched. A single
// roster import is ~2,600 rows — an unpaged read silently truncates it.
const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 200;
const WRITE_CHUNK_SIZE = 500;
const UPDATE_CONCURRENCY = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runBatched<T, R>(items: T[], size: number, fn: (item: T) => PromiseLike<R>): Promise<R[]> {
  const out: R[] = [];
  for (const part of chunk(items, size)) out.push(...(await Promise.all(part.map(fn))));
  return out;
}

async function insertInChunks(table: string, rows: any[], errorMessage: string) {
  let count = 0;
  for (const part of chunk(rows, WRITE_CHUNK_SIZE)) {
    const result = await supabase.from(table).insert(part);
    if (result.error) throw new ApiError(500, errorMessage, result.error);
    count += part.length;
  }
  return count;
}

// Chunked bulk upsert keyed on a unique constraint. Far faster and more resilient than
// thousands of per-row UPDATE requests, which made large-roster commits take minutes and
// tripped transient ECONNRESET failures. Postgres rejects two rows hitting the same conflict
// target in one statement, so callers must dedupe on the conflict columns first.
async function upsertInChunks(table: string, rows: any[], onConflict: string, errorMessage: string) {
  let count = 0;
  for (const part of chunk(rows, WRITE_CHUNK_SIZE)) {
    const result = await supabase.from(table).upsert(part, { onConflict });
    if (result.error) throw new ApiError(500, errorMessage, result.error);
    count += part.length;
  }
  return count;
}

// Keep the last row for each conflict key so a bulk upsert chunk never targets the same
// unique key twice.
function dedupeBy<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(keyFn(row), row);
  return [...map.values()];
}

async function loadGuildIdForLeague(leagueId: string): Promise<string | null> {
  const link = await supabase
    .from("rec_server_league_links")
    .select("server_id")
    .eq("league_id", leagueId)
    .eq("is_primary", true)
    .maybeSingle();
  const serverId = (link.data as any)?.server_id;
  if (!serverId) return null;
  const server = await supabase
    .from("rec_discord_servers")
    .select("guild_id")
    .eq("id", serverId)
    .maybeSingle();
  return (server.data as any)?.guild_id ? String((server.data as any).guild_id) : null;
}

async function loadStagedRows(table: string, importJobId: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase.from(table).select("*").eq("import_job_id", importJobId).order("id").range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new ApiError(500, `Failed to load ${table}.`, result.error);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadExistingByColumn(table: string, select: string, leagueId: string, column: string, values: string[], errorMessage: string, weekNumbers?: number[]) {
  const rows: any[] = [];
  for (const part of chunk([...new Set(values)], IN_CHUNK_SIZE)) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = supabase.from(table).select(select).eq("league_id", leagueId).in(column, part);
      if (weekNumbers && weekNumbers.length > 0) query = query.in("week_number", weekNumbers);
      const result = await query.order("id").range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new ApiError(500, errorMessage, result.error);
      const page = (result.data ?? []) as any[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function upsertTeams(importJobId: string, leagueId: string) {
  const stagedTeams = await loadStagedRows("rec_import_staging_teams", importJobId);
  if (stagedTeams.length === 0) return { addedOrUpdated: 0, teamMap: new Map<string, string>() };

  const rows = (stagedTeams as any[]).map((team: any) => {
    const raw = asObject(team.raw_payload);
    const name = stagedTeamDisplayName(team);
    const abbreviation = team.abbr_name ?? team.abbreviation ?? raw.abbrName ?? null;
    // Prefer canonical NFL alignment so conference/division are always correct.
    const canonical = canonicalTeam(name, abbreviation);
    return {
      league_id: leagueId,
      name,
      abbreviation,
      conference: canonical?.conference ?? team.conference ?? raw.conferenceName ?? null,
      division: canonical?.division ?? team.division_name ?? raw.divName ?? null,
      madden_team_id: teamExternalId(team),
      source: SOURCE_TYPE,
      // Observed identity from this import, used to flag custom/relocated team data conflicts during advance.
      import_city: toNullableText(raw.cityName),
      import_nick: toNullableText(raw.nickName),
      import_abbr: toNullableText(team.abbr_name ?? team.abbreviation ?? raw.abbrName),
      updated_at: new Date().toISOString()
    };
  }).filter((team) => team.name && team.madden_team_id);

  // Bulk load all existing teams for this league matching staged madden_team_ids, abbreviations, or names.
  // Abbreviation matching is critical: EA franchises often use custom team names ("Green Bay Pack"),
  // so name matching alone would create duplicates of the league's existing standard teams.
  const maddenIds = rows.map((r) => r.madden_team_id).filter(Boolean) as string[];
  const names = rows.map((r) => r.name).filter(Boolean);
  const abbrs = rows.map((r) => r.abbreviation).filter(Boolean).map((a) => String(a).toUpperCase());

  const existingByMaddenId = new Map<string, any>();
  const existingByAbbr = new Map<string, any>();
  const existingByName = new Map<string, any>();

  if (maddenIds.length > 0) {
    const byId = await supabase.from("rec_teams").select("id,name,abbreviation,madden_team_id").eq("league_id", leagueId).in("madden_team_id", maddenIds);
    if (byId.error) throw new ApiError(500, "Failed to load existing teams by madden_team_id.", byId.error);
    for (const t of byId.data ?? []) {
      if (t.madden_team_id) existingByMaddenId.set(String(t.madden_team_id), t);
    }
  }
  if (abbrs.length > 0) {
    const byAbbr = await supabase.from("rec_teams").select("id,name,abbreviation,madden_team_id").eq("league_id", leagueId).in("abbreviation", abbrs);
    if (byAbbr.error) throw new ApiError(500, "Failed to load existing teams by abbreviation.", byAbbr.error);
    for (const t of byAbbr.data ?? []) {
      if (t.abbreviation) existingByAbbr.set(String(t.abbreviation).toUpperCase(), t);
    }
  }
  if (names.length > 0) {
    const byName = await supabase.from("rec_teams").select("id,name,abbreviation,madden_team_id").eq("league_id", leagueId).in("name", names);
    if (byName.error) throw new ApiError(500, "Failed to load existing teams by name.", byName.error);
    for (const t of byName.data ?? []) {
      if (t.name) existingByName.set(t.name, t);
    }
  }

  const toInsert: typeof rows = [];
  const toUpdate: Array<{ id: string; row: typeof rows[number] }> = [];

  for (const row of rows) {
    const existing =
      (row.madden_team_id ? existingByMaddenId.get(row.madden_team_id) : null) ??
      (row.abbreviation ? existingByAbbr.get(String(row.abbreviation).toUpperCase()) : null) ??
      existingByName.get(row.name);
    if (existing?.id) {
      toUpdate.push({ id: existing.id, row });
    } else {
      toInsert.push(row);
    }
  }

  const teamMap = new Map<string, string>();

  // Batch insert new teams
  if (toInsert.length > 0) {
    const inserted = await supabase.from("rec_teams").insert(toInsert).select("id,name,madden_team_id");
    if (inserted.error) throw new ApiError(500, "Failed to insert new teams.", inserted.error);
    for (const t of inserted.data ?? []) {
      if (t.madden_team_id) teamMap.set(String(t.madden_team_id), t.id);
    }
  }

  // Parallel update existing teams. Preserve the league's existing team name and only fill
  // conference/division when EA provides them, so matching an EA franchise to standard teams
  // never renames them or wipes their conference.
  const updateResults = await Promise.all(
    toUpdate.map(({ id, row }) => {
      const patch: Record<string, unknown> = {
        madden_team_id: row.madden_team_id,
        source: row.source,
        updated_at: row.updated_at
      };
      if (row.abbreviation) patch.abbreviation = row.abbreviation;
      if (row.conference) patch.conference = row.conference;
      if (row.division) patch.division = row.division;
      if (row.import_city) patch.import_city = row.import_city;
      if (row.import_nick) patch.import_nick = row.import_nick;
      if (row.import_abbr) patch.import_abbr = row.import_abbr;
      return supabase.from("rec_teams").update(patch).eq("id", id).select("id,name,madden_team_id").single();
    })
  );
  for (const result of updateResults) {
    if (result.error) throw new ApiError(500, "Failed to update existing team.", result.error);
    if (result.data?.madden_team_id) teamMap.set(String(result.data.madden_team_id), result.data.id);
  }

  return { addedOrUpdated: toInsert.length + toUpdate.length, teamMap };
}

async function loadTeamMap(leagueId: string) {
  const result = await supabase.from("rec_teams").select("id,madden_team_id").eq("league_id", leagueId).not("madden_team_id", "is", null);
  if (result.error) throw new ApiError(500, "Failed to load committed team map.", result.error);
  const teamMap = new Map<string, string>();
  for (const team of (result.data ?? []) as TeamRow[]) if (team.madden_team_id) teamMap.set(String(team.madden_team_id), team.id);
  return teamMap;
}

async function buildTeamMapFromStaging(importJobId: string, leagueId: string) {
  const stagedTeams = await loadStagedRows("rec_import_staging_teams", importJobId);
  if (stagedTeams.length === 0) return new Map<string, string>();

  const committedTeams = await supabase.from("rec_teams").select("id,name,abbreviation,madden_team_id").eq("league_id", leagueId);
  if (committedTeams.error) throw new ApiError(500, "Failed to load committed teams for staged map.", committedTeams.error);

  const byName = new Map<string, any>();
  const byAbbr = new Map<string, any>();
  const map = new Map<string, string>();

  for (const team of (committedTeams.data ?? []) as any[]) {
    const nameKey = normalizedLookup(team.name);
    const abbrKey = normalizedLookup(team.abbreviation);
    if (nameKey) byName.set(nameKey, team);
    if (abbrKey) byAbbr.set(abbrKey, team);
    if (team.madden_team_id) map.set(String(team.madden_team_id), team.id);
  }

  const maddenIdUpdates: Array<{ id: string; madden_team_id: string }> = [];

  for (const staged of stagedTeams as any[]) {
    const raw = asObject(staged.raw_payload);
    const externalId = teamExternalId(staged);
    if (!externalId) continue;
    const committed = byName.get(normalizedLookup(stagedTeamDisplayName(staged)) ?? "") ?? byAbbr.get(normalizedLookup(staged.abbr_name ?? staged.abbreviation ?? raw.abbrName) ?? "");
    if (committed?.id) {
      map.set(String(externalId), committed.id);
      if (!committed.madden_team_id) {
        maddenIdUpdates.push({ id: committed.id, madden_team_id: String(externalId) });
      }
    }
  }

  // Parallel update madden_team_id for matched teams that lacked it
  if (maddenIdUpdates.length > 0) {
    await Promise.all(
      maddenIdUpdates.map(({ id, madden_team_id }) =>
        supabase.from("rec_teams").update({ madden_team_id, updated_at: new Date().toISOString() }).eq("id", id)
      )
    );
  }

  return map;
}

async function loadAssignmentMap(leagueId: string) {
  const result = await supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (result.error) throw new ApiError(500, "Failed to load active team assignments.", result.error);
  const assignmentMap = new Map<string, string>();
  for (const assignment of (result.data ?? []) as AssignmentRow[]) if (assignment.team_id && assignment.user_id) assignmentMap.set(assignment.team_id, assignment.user_id);
  return assignmentMap;
}

async function upsertGamesAndResults(importJobId: string, leagueId: string, teamMap: Map<string, string>, assignmentMap: Map<string, string>, seasonNumber: number) {
  const stagedGames = await loadStagedRows("rec_import_staging_games", importJobId);
  if (stagedGames.length === 0) return { gamesAddedOrUpdated: 0, resultsAddedOrUpdated: 0, gamesSkipped: 0 };

  const now = new Date().toISOString();

  // Collect all external team IDs that are missing from the teamMap so we can resolve them in bulk
  const missingExternalIds = new Set<string>();
  for (const game of stagedGames as any[]) {
    const homeId = gameTeamExternalId(game, "home");
    const awayId = gameTeamExternalId(game, "away");
    if (homeId && !teamMap.has(String(homeId))) missingExternalIds.add(String(homeId));
    if (awayId && !teamMap.has(String(awayId))) missingExternalIds.add(String(awayId));
  }

  // Bulk resolve any teams not yet in the map
  if (missingExternalIds.size > 0) {
    const ids = Array.from(missingExternalIds);
    const existing = await supabase.from("rec_teams").select("id,madden_team_id").eq("league_id", leagueId).in("madden_team_id", ids);
    if (existing.error) throw new ApiError(500, "Failed to bulk-check fallback teams.", existing.error);
    const foundIds = new Set<string>();
    for (const t of existing.data ?? []) {
      if (t.madden_team_id) { teamMap.set(String(t.madden_team_id), t.id); foundIds.add(String(t.madden_team_id)); }
    }

    // Insert any still-missing teams
    const stillMissing = ids.filter((id) => !foundIds.has(id));
    if (stillMissing.length > 0) {
      // Build fallback team names from staged game data
      const nameMap = new Map<string, string>();
      for (const game of stagedGames as any[]) {
        const homeId = gameTeamExternalId(game, "home");
        const awayId = gameTeamExternalId(game, "away");
        if (homeId && stillMissing.includes(String(homeId))) nameMap.set(String(homeId), normalizeTeamName(game.home_team_name, `Home Team ${homeId}`));
        if (awayId && stillMissing.includes(String(awayId))) nameMap.set(String(awayId), normalizeTeamName(game.away_team_name, `Away Team ${awayId}`));
      }
      const fallbackRows = stillMissing.map((id) => ({
        league_id: leagueId,
        name: nameMap.get(id) ?? `Team ${id}`,
        madden_team_id: id,
        source: SOURCE_TYPE,
        updated_at: now
      }));
      const inserted = await supabase.from("rec_teams").insert(fallbackRows).select("id,madden_team_id");
      if (inserted.error) throw new ApiError(500, "Failed to create fallback teams for imported games.", inserted.error);
      for (const t of inserted.data ?? []) {
        if (t.madden_team_id) teamMap.set(String(t.madden_team_id), t.id);
      }
    }
  }

  // Build game rows, skipping any that still can't resolve teams
  const gameRows: any[] = [];
  const skipped: any[] = [];

  for (const game of stagedGames as any[]) {
    const homeExternalId = gameTeamExternalId(game, "home");
    const awayExternalId = gameTeamExternalId(game, "away");
    const homeTeamId = homeExternalId ? teamMap.get(String(homeExternalId)) ?? null : null;
    const awayTeamId = awayExternalId ? teamMap.get(String(awayExternalId)) ?? null : null;

    if (!homeTeamId || !awayTeamId) {
      skipped.push({ externalGameId: game.external_game_id ?? String(asObject(game.raw_payload).scheduleId ?? ""), homeExternalId, awayExternalId, reason: "unresolved_team" });
      continue;
    }

    const status = gameStatus(game);
    gameRows.push({
      league_id: leagueId,
      week_number: game.week_number ?? null,
      phase: gamePhase(game.week_number, game.season_stage),
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_user_id: assignmentMap.get(homeTeamId) ?? null,
      away_user_id: assignmentMap.get(awayTeamId) ?? null,
      home_score: isFinalScore(game.home_score, game.away_score) ? toNumber(game.home_score) : null,
      away_score: isFinalScore(game.home_score, game.away_score) ? toNumber(game.away_score) : null,
      status,
      source: SOURCE_TYPE,
      import_verified: true,
      manual_entered: false,
      result_payout_eligible: status === "completed",
      eos_payout_eligible: true,
      external_game_id: game.external_game_id ?? String(asObject(game.raw_payload).scheduleId ?? ""),
      locked: false,
      updated_at: now
    });
  }

  if (gameRows.length === 0) {
    return { gamesAddedOrUpdated: 0, resultsAddedOrUpdated: 0, gamesSkipped: skipped.length, skippedGames: skipped };
  }

  // Bulk load existing games by external_game_id
  const allExternalGameIds = gameRows.map((r) => r.external_game_id).filter(Boolean);
  const existingGamesByExternalId = new Map<string, CommittedGameRow>();

  if (allExternalGameIds.length > 0) {
    const existing = await loadExistingByColumn(
      "rec_games",
      "id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase",
      leagueId, "external_game_id", allExternalGameIds, "Failed to bulk-load existing games."
    );
    for (const g of existing) {
      if (g.external_game_id) existingGamesByExternalId.set(g.external_game_id, g as CommittedGameRow);
    }
  }

  const toInsertGames = gameRows.filter((r) => !existingGamesByExternalId.has(r.external_game_id));
  const toUpdateGames = gameRows.filter((r) => existingGamesByExternalId.has(r.external_game_id));

  const savedGames: CommittedGameRow[] = [];

  // Batch insert new games (chunked so the returned rows stay under the response cap)
  if (toInsertGames.length > 0) {
    for (const part of chunk(toInsertGames, WRITE_CHUNK_SIZE)) {
      const inserted = await supabase
        .from("rec_games")
        .insert(part)
        .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase");
      if (inserted.error) throw new ApiError(500, "Failed to batch-insert imported games.", inserted.error);
      savedGames.push(...((inserted.data ?? []) as CommittedGameRow[]));
    }
  }

  // Update existing games with bounded concurrency
  if (toUpdateGames.length > 0) {
    const updateResults = await runBatched(toUpdateGames, UPDATE_CONCURRENCY, (row) => {
      const existing = existingGamesByExternalId.get(row.external_game_id)!;
      return supabase
        .from("rec_games")
        .update(row)
        .eq("id", existing.id)
        .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase")
        .single();
    });
    for (const result of updateResults) {
      if (result.error) throw new ApiError(500, "Failed to update imported game.", result.error);
      if (result.data) savedGames.push(result.data as CommittedGameRow);
    }
  }

  // Only process results for completed games
  const completedGames = savedGames.filter((g) => {
    const row = gameRows.find((r) => r.external_game_id === g.external_game_id);
    return row?.status === "completed" && g.external_game_id;
  });

  let resultsAddedOrUpdated = 0;

  if (completedGames.length > 0) {
    const completedExternalIds = completedGames.map((g) => g.external_game_id).filter(Boolean) as string[];

    // Bulk load existing results
    const existingResultsByExternalId = new Map<string, string>();
    const existingResults = await loadExistingByColumn(
      "rec_game_results", "id,external_game_id", leagueId, "external_game_id", completedExternalIds,
      "Failed to bulk-load existing game results."
    );
    for (const r of existingResults) {
      if (r.external_game_id) existingResultsByExternalId.set(r.external_game_id, r.id);
    }

    const resultRows = completedGames.map((savedGame) => {
      const isTie = (savedGame.home_score ?? 0) === (savedGame.away_score ?? 0);
      const isPlayoff = savedGame.phase !== "regular_season";
      return {
        league_id: leagueId,
        import_job_id: importJobId,
        season_number: seasonNumber,
        week_number: savedGame.week_number,
        game_type: savedGame.phase ?? "regular_season",
        external_game_id: savedGame.external_game_id,
        home_team_id: savedGame.home_team_id,
        away_team_id: savedGame.away_team_id,
        home_user_id: savedGame.home_user_id,
        away_user_id: savedGame.away_user_id,
        home_score: savedGame.home_score ?? 0,
        away_score: savedGame.away_score ?? 0,
        winning_user_id: isTie ? null : (savedGame.home_score ?? 0) > (savedGame.away_score ?? 0) ? savedGame.home_user_id : savedGame.away_user_id,
        losing_user_id: isTie ? null : (savedGame.home_score ?? 0) > (savedGame.away_score ?? 0) ? savedGame.away_user_id : savedGame.home_user_id,
        winning_team_id: isTie ? null : (savedGame.home_score ?? 0) > (savedGame.away_score ?? 0) ? savedGame.home_team_id : savedGame.away_team_id,
        losing_team_id: isTie ? null : (savedGame.home_score ?? 0) > (savedGame.away_score ?? 0) ? savedGame.away_team_id : savedGame.home_team_id,
        is_user_h2h: Boolean(savedGame.home_user_id && savedGame.away_user_id),
        is_playoff: isPlayoff,
        is_super_bowl: savedGame.phase === "super_bowl",
        is_cpu_game: !savedGame.home_user_id || !savedGame.away_user_id,
        is_tie: isTie,
        played_at: now,
        source: RESULT_SOURCE,
        raw_payload: { importJobId, externalGameId: savedGame.external_game_id, recGameId: savedGame.id },
        updated_at: now
      };
    });

    const toInsertResults = resultRows.filter((r) => !existingResultsByExternalId.has(r.external_game_id!));
    const toUpdateResults = resultRows.filter((r) => existingResultsByExternalId.has(r.external_game_id!));

    // Batch insert new results
    if (toInsertResults.length > 0) {
      resultsAddedOrUpdated += await insertInChunks("rec_game_results", toInsertResults, "Failed to batch-insert imported game results.");
    }

    // Update existing results with bounded concurrency
    if (toUpdateResults.length > 0) {
      const updateResults = await runBatched(toUpdateResults, UPDATE_CONCURRENCY, (row) => {
        const existingId = existingResultsByExternalId.get(row.external_game_id!)!;
        return supabase.from("rec_game_results").update(row).eq("id", existingId).select("id").single();
      });
      for (const result of updateResults) {
        if (result.error) throw new ApiError(500, "Failed to update imported game result.", result.error);
        if (result.data) resultsAddedOrUpdated++;
      }
    }
  }

  return { gamesAddedOrUpdated: savedGames.length, resultsAddedOrUpdated, gamesSkipped: skipped.length, skippedGames: skipped };
}

async function upsertStandings(importJobId: string, leagueId: string, teamMap: Map<string, string>, seasonNumber: number) {
  // W-L-T standings themselves are derived during advance, but we DO persist the EA playoff
  // seed / playoffStatus per team into rec_season_team_seeds. This is the authoritative source for
  // "did this team make the playoffs" — crucially it captures first-round-bye teams that have no
  // wild-card game yet, which EOS payouts need so byes aren't flagged "missed playoffs".
  const staged = await loadStagedRows("rec_import_staging_standings", importJobId);
  if (!staged.length) return 0;

  const now = new Date().toISOString();
  const rows = (staged as any[]).map((row: any) => {
    const ext = teamExternalId(row);
    const teamId = ext ? teamMap.get(ext) ?? null : null;
    if (!teamId) return null;
    const raw = asObject(row.raw_payload);
    const seed = toNullableInt(raw.seed);
    const playoffStatus = toNullableInt(raw.playoffStatus);
    // playoffStatus: 0 = eliminated, 2/3/4 = clinched (wildcard/division/bye). Fall back to seed
    // (per-conference 1..7 = in) when EA omits playoffStatus.
    const madePlayoffs = (playoffStatus != null && playoffStatus !== 0) || (seed != null && seed >= 1 && seed <= 7);
    return {
      league_id: leagueId,
      season_number: seasonNumber,
      team_id: teamId,
      conference: toNullableText(row.conference_name),
      seed,
      playoff_status: playoffStatus,
      made_playoffs: madePlayoffs,
      updated_at: now
    };
  }).filter(Boolean) as any[];

  if (!rows.length) return 0;
  const deduped = dedupeBy(rows, (r) => r.team_id);
  return await upsertInChunks(
    "rec_season_team_seeds", deduped,
    "league_id,season_number,team_id",
    "Failed to upsert season team seeds."
  );
}

async function upsertPlayers(importJobId: string, leagueId: string, _teamMap: Map<string, string>, _seasonNumber: number, _weekNumber: number) {
  const staged = await loadStagedRows("rec_import_staging_rosters", importJobId);
  if (staged.length === 0) return 0;

  const now = new Date().toISOString();
  // Map to the deployed slim rec_players schema. Detailed ratings/traits/contract live in raw_payload.
  const playerRows = (staged as any[]).map((row: any) => {
    const raw = asObject(row.raw_payload);
    const maddenPlayerId = toNullableText(row.player_external_id ?? row.external_player_id ?? raw.rosterId ?? raw.playerId);
    const firstName = toNullableText(row.first_name ?? raw.firstName);
    const lastName = toNullableText(row.last_name ?? raw.lastName);
    const fullName = toNullableText(row.player_name ?? row.player_display_name) ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
    const devTrait = toNullableText(raw.devTrait ?? raw.devtrait ?? raw.developmentTrait);
    const overallRating = toNullableInt(raw.overallRating ?? raw.overall ?? raw.playerBestOvr ?? raw.playerSchemeOvr ?? raw.ovrRating);
    const abilityCount = Array.isArray(raw.signatureSlotList)
      ? raw.signatureSlotList.filter((s: any) => s && s.isEmpty === false).length
      : null;
    return {
      league_id: leagueId,
      madden_player_id: maddenPlayerId,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      position: toNullableText(row.position ?? raw.position),
      college: toNullableText(raw.college),
      height_inches: toNullableInt(raw.height),
      weight_lbs: toNullableInt(raw.weight),
      dev_trait: devTrait,
      overall_rating: overallRating,
      // Promoted typed fields (also backfilled from raw_payload via migration 202606120003)
      scheme: toNullableInt(raw.scheme),
      years_pro: toNullableInt(raw.yearsPro),
      resign_status: toNullableInt(raw.reSignStatus),
      contract_years_left: toNullableInt(raw.contractYearsLeft),
      contract_salary: toNullableInt(raw.contractSalary),
      cap_hit: toNullableInt(raw.capHit),
      cap_release_penalty: toNullableInt(raw.capReleasePenalty),
      cap_release_net_savings: toNullableInt(raw.capReleaseNetSavings),
      is_free_agent: typeof raw.isFreeAgent === "boolean" ? raw.isFreeAgent : null,
      is_xfactor: devTrait != null ? Number(devTrait) === 3 : null,
      ability_count: abilityCount,
      raw_payload: row.raw_payload ?? null,
      updated_at: now
    };
  }).filter((p) => p.madden_player_id && p.full_name);

  // rec_players has UNIQUE (league_id, madden_player_id); one chunked bulk upsert handles both
  // insert and update. Dedupe on madden_player_id first so a chunk can't target the same key twice.
  const deduped = dedupeBy(playerRows, (r) => String(r.madden_player_id));
  const count = await upsertInChunks("rec_players", deduped, "league_id,madden_player_id", "Failed to upsert imported players.");
  return count;
}


async function refreshRosterSnapshots(
  importJobId: string,
  leagueId: string,
  seasonNumber: number,
  weekNumber: number | null
) {
  const result = await supabase.rpc("rec_refresh_roster_snapshots", {
    p_league_id: leagueId,
    p_season_number: seasonNumber,
    p_week_number: weekNumber,
    p_import_job_id: importJobId
  });

  if (result.error) {
    throw new ApiError(500, "Failed to refresh roster snapshots.", result.error);
  }

  const row = Array.isArray(result.data) ? result.data[0] : result.data;

  return {
    sourceRows: Number(row?.source_rows ?? 0),
    insertedRows: Number(row?.inserted_rows ?? 0),
    updatedRows: Number(row?.updated_rows ?? 0),
    deactivatedRows: Number(row?.deactivated_rows ?? 0),
    activeSnapshotRows: Number(row?.active_snapshot_rows ?? 0)
  };
}

async function upsertWeeklyStats(importJobId: string, leagueId: string, teamMap: Map<string, string>, seasonNumber: number) {
  const [playerStats, teamStats] = await Promise.all([
    loadStagedRows("rec_import_staging_player_stats", importJobId),
    loadStagedRows("rec_import_staging_team_stats", importJobId)
  ]);

  const now = new Date().toISOString();
  const guildId = await loadGuildIdForLeague(leagueId);

  // Tracks raw import keys that did not map to any canonical REC stat, for admin/debug surfacing.
  const unmappedKeyCounts = new Map<string, number>();
  const noteUnmapped = (unmapped: Record<string, unknown>) => {
    for (const key of Object.keys(unmapped)) unmappedKeyCounts.set(key, (unmappedKeyCounts.get(key) ?? 0) + 1);
  };

  // ---- Player stats → rec_player_weekly_stats (keyed on madden_player_id) ----
  const playerStatRows = (playerStats as any[]).map((row: any) => {
    const maddenPlayerId = toNullableText(row.player_external_id ?? row.external_player_id);
    const maddenTeamId = toNullableText(row.team_external_id ?? row.external_team_id);
    const statCategory = row.stat_category ?? "general";
    // Normalize raw EA stat keys into canonical REC stat keys before storage. Canonical keys are
    // merged alongside the original keys (union) so legacy raw-key readers keep working during
    // migration. We normalize row.stats (the stat line) only — raw_payload holds identity/ratings
    // noise — and preserve raw_payload unchanged for audit/debug.
    const normalized = normalizeImportedStats({ scope: "player", statCategory, stats: row.stats ?? {} });
    noteUnmapped(normalized.unmappedStats);
    return {
      league_id: leagueId,
      guild_id: guildId,
      import_job_id: importJobId,
      season_number: seasonNumber,
      season_stage: row.season_stage ?? "regular_season",
      week_number: row.week_number ?? null,
      player_id: null as string | null, // filled below after bulk lookup
      team_id: maddenTeamId ? teamMap.get(maddenTeamId) ?? null : null,
      madden_player_id: maddenPlayerId,
      madden_team_id: maddenTeamId,
      source_stat_id: sourceStatId(row, String(statCategory)),
      source_schedule_id: sourceScheduleId(row),
      source_stage_index: sourceInt(row, "stageIndex"),
      source_week_index: sourceInt(row, "weekIndex"),
      source_team_id: sourceText(row, "teamId") ?? maddenTeamId,
      source_roster_id: sourceText(row, "rosterId") ?? maddenPlayerId,
      player_name: row.player_name ?? row.player_display_name ?? null,
      team_name: row.team_name ?? row.team_display_name ?? null,
      position: row.position ?? null,
      stat_category: statCategory,
      stats: { ...(row.stats ?? {}), ...normalized.canonicalStats },
      raw_payload: row.raw_payload ?? null,
      updated_at: now
    };
  }).filter((r) => r.madden_player_id);

  // Resolve player_id (FK to rec_players) by madden_player_id
  const statMaddenIds = [...new Set(playerStatRows.map((r) => r.madden_player_id).filter(Boolean))] as string[];
  const playerIdByMaddenId = new Map<string, string>();
  if (statMaddenIds.length > 0) {
    try {
      const players = await loadExistingByColumn("rec_players", "id,madden_player_id", leagueId, "madden_player_id", statMaddenIds, "Failed to load players for stat linking.");
      for (const p of players) if (p.madden_player_id) playerIdByMaddenId.set(String(p.madden_player_id), p.id);
    } catch {
      // Non-fatal: stats still commit keyed on madden_player_id; player_id stays null.
    }
  }
  for (const row of playerStatRows) {
    if (row.madden_player_id) row.player_id = playerIdByMaddenId.get(String(row.madden_player_id)) ?? null;
  }

  // rec_player_weekly_stats is keyed by league/season/team/player/category plus Madden source
  // identity. source_stat_id/source_schedule_id are preferred; deterministic week fallbacks keep
  // legacy payloads idempotent without merging rows across teams or schedules.
  const dedupedPS = dedupeBy(playerStatRows, (r) => `${r.season_number}|${r.team_id ?? ""}|${r.player_id ?? ""}|${r.madden_player_id}|${r.stat_category}|${r.source_stat_id}|${r.source_schedule_id}`);
  const playerCount = await upsertInChunks(
    "rec_player_weekly_stats", dedupedPS,
    "league_id,season_number,team_id,player_id,madden_player_id,stat_category,source_stat_id,source_schedule_id",
    "Failed to upsert imported player weekly stats."
  );

  // ---- Team stats → rec_team_weekly_stats (keyed on madden_team_id) ----
  const teamStatRows = (teamStats as any[]).map((row: any) => {
    const maddenTeamId = toNullableText(row.team_external_id ?? row.external_team_id);
    const statCategory = row.stat_category ?? "general";
    const normalized = normalizeImportedStats({ scope: "team", statCategory, stats: row.stats ?? {} });
    noteUnmapped(normalized.unmappedStats);
    return {
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: seasonNumber,
      season_stage: row.season_stage ?? "regular_season",
      week_number: row.week_number ?? null,
      team_id: maddenTeamId ? teamMap.get(maddenTeamId) ?? null : null,
      madden_team_id: maddenTeamId,
      team_name: row.team_name ?? row.team_display_name ?? null,
      stat_category: statCategory,
      stats: { ...(row.stats ?? {}), ...normalized.canonicalStats },
      raw_payload: row.raw_payload ?? null,
      updated_at: now
    };
  }).filter((r) => r.madden_team_id);

  // rec_team_weekly_stats has UNIQUE (league_id, season_number, season_stage, week_number,
  // madden_team_id, stat_category); a chunked bulk upsert handles insert and update together.
  const dedupedTS = dedupeBy(teamStatRows, (r) => `${r.season_number}|${r.season_stage}|${r.week_number}|${r.madden_team_id}|${r.stat_category}`);
  const teamCount = await upsertInChunks(
    "rec_team_weekly_stats", dedupedTS,
    "league_id,season_number,season_stage,week_number,madden_team_id,stat_category",
    "Failed to upsert imported team weekly stats."
  );

  // Surface the most common unmapped raw stat keys so the canonical map can be expanded over time.
  const unmappedStatKeys = [...unmappedKeyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([key, count]) => ({ key, count }));

  return { playerCount, teamCount, unmappedStatKeys };
}

async function commitLeagueFeedEvents(importJobId: string, leagueId: string, teamMap: Map<string, string>) {
  const staged = await loadStagedRows("rec_import_staging_league_feed", importJobId);
  if (!staged.length) return { feedEvents: 0 };

  const guildId = await loadGuildIdForLeague(leagueId);
  if (!guildId) return { feedEvents: 0, warning: "No guild_id found for league feed events." };

  const playerExternalIds = [...new Set(staged.map((row: any) => row.player_external_id).filter(Boolean).map(String))];
  const playersByExternal = new Map<string, string>();
  if (playerExternalIds.length) {
    const rows = await loadExistingByColumn("rec_players", "id,madden_player_id", leagueId, "madden_player_id", playerExternalIds, "Failed to load players for feed event linking.");
    for (const row of rows) {
      if ((row as any).madden_player_id) playersByExternal.set(String((row as any).madden_player_id), String((row as any).id));
    }
  }

  const events = staged.map((row: any, index: number) => {
    const teamId = row.team_external_id ? teamMap.get(String(row.team_external_id)) ?? null : null;
    const fromTeamId = row.from_team_external_id ? teamMap.get(String(row.from_team_external_id)) ?? null : null;
    const toTeamId = row.to_team_external_id ? teamMap.get(String(row.to_team_external_id)) ?? null : null;
    const title = toNullableText(row.title) ?? `${String(row.event_type ?? "League event").replaceAll("_", " ")} ${index + 1}`;
    const eventHash = row.external_event_id
      ? `${row.endpoint_key}:${row.external_event_id}`
      : `${row.endpoint_key}:${row.source_hash}`;

    return {
      guild_id: guildId,
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: row.season_number,
      season_index: row.season_index,
      season_stage: row.season_stage,
      week_number: row.week_number,
      source: "ea_import",
      source_endpoint: row.endpoint_key,
      event_type: row.event_type,
      event_category: row.event_category,
      external_event_id: row.external_event_id,
      event_hash: eventHash,
      title,
      body: row.body,
      player_id: row.player_external_id ? playersByExternal.get(String(row.player_external_id)) ?? null : null,
      player_external_id: row.player_external_id,
      player_name: row.player_name,
      team_id: teamId,
      team_external_id: row.team_external_id,
      team_name: row.team_name,
      from_team_id: fromTeamId,
      from_team_external_id: row.from_team_external_id,
      from_team_name: row.from_team_name,
      to_team_id: toTeamId,
      to_team_external_id: row.to_team_external_id,
      to_team_name: row.to_team_name,
      payload: row.raw_payload ?? {},
      occurred_at: row.occurred_at,
      updated_at: new Date().toISOString()
    };
  });

  const count = await upsertInChunks(
    "rec_league_event_logs",
    dedupeBy(events, (row) => row.event_hash),
    "league_id,event_hash",
    "Failed to upsert league feed events."
  );
  return { feedEvents: count };
}

async function commitRosterDiffEvents(importJobId: string, leagueId: string, seasonNumber: number, weekNumber: number | null) {
  const staged = await loadStagedRows("rec_import_staging_rosters", importJobId);
  if (!staged.length) return { rosterDiffEvents: 0 };

  const guildId = await loadGuildIdForLeague(leagueId);
  if (!guildId) return { rosterDiffEvents: 0, warning: "No guild_id found for roster diff events." };

  const incoming = staged.map((row: any) => {
    const raw = asObject(row.raw_payload);
    const maddenPlayerId = toNullableText(row.player_external_id ?? row.external_player_id ?? raw.rosterId ?? raw.playerId);
    const firstName = toNullableText(row.first_name ?? raw.firstName);
    const lastName = toNullableText(row.last_name ?? raw.lastName);
    const fullName = toNullableText(row.player_name ?? row.player_display_name) ?? ([firstName, lastName].filter(Boolean).join(" ") || null);
    const devTrait = toNullableText(raw.devTrait ?? raw.devtrait ?? raw.developmentTrait);
    const overallRating = toNullableInt(raw.overallRating ?? raw.overall ?? raw.playerBestOvr ?? raw.playerSchemeOvr ?? raw.ovrRating);
    const abilityCount = Array.isArray(raw.signatureSlotList)
      ? raw.signatureSlotList.filter((s: any) => s && s.isEmpty === false).length
      : null;
    return {
      maddenPlayerId,
      fullName,
      position: toNullableText(row.position ?? raw.position),
      devTrait,
      overallRating,
      abilityCount,
      raw
    };
  }).filter((row) => row.maddenPlayerId && row.fullName);

  const deduped = dedupeBy(incoming, (row) => String(row.maddenPlayerId));
  const ids = deduped.map((row) => String(row.maddenPlayerId));
  if (!ids.length) return { rosterDiffEvents: 0 };

  const existing = await loadExistingByColumn(
    "rec_players",
    "id,madden_player_id,full_name,position,dev_trait,overall_rating,ability_count",
    leagueId,
    "madden_player_id",
    ids,
    "Failed to load players for roster diff events."
  );
  const existingByMaddenId = new Map(existing.map((row: any) => [String(row.madden_player_id), row]));
  const events: any[] = [];

  const addEvent = (row: typeof deduped[number], previous: any, eventType: string, label: string, fromValue: unknown, toValue: unknown) => {
    if (fromValue == null || toValue == null || String(fromValue) === String(toValue)) return;
    const playerName = row.fullName ?? previous.full_name ?? `Player ${row.maddenPlayerId}`;
    events.push({
      guild_id: guildId,
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: seasonNumber,
      week_number: weekNumber,
      source: "roster_diff",
      source_endpoint: "rosters",
      event_type: eventType,
      event_category: label,
      external_event_id: null,
      event_hash: `roster_diff:${row.maddenPlayerId}:${label}:${fromValue}:${toValue}:s${seasonNumber}:w${weekNumber ?? "na"}`,
      title: `${playerName} ${label.replaceAll("_", " ")}`,
      body: `${playerName}: ${String(fromValue)} -> ${String(toValue)}`,
      player_id: previous.id,
      player_external_id: row.maddenPlayerId,
      player_name: playerName,
      payload: { fromValue, toValue, raw: row.raw },
      updated_at: new Date().toISOString()
    });
  };

  for (const row of deduped) {
    const previous = existingByMaddenId.get(String(row.maddenPlayerId));
    if (!previous) continue;
    addEvent(row, previous, "position_change", "position_change", previous.position, row.position);
    addEvent(row, previous, "ability_update", "dev_trait_change", previous.dev_trait, row.devTrait);
    addEvent(row, previous, "ability_update", "ability_count_change", previous.ability_count, row.abilityCount);
    addEvent(row, previous, "player_rating_update", "overall_rating_change", previous.overall_rating, row.overallRating);
  }

  if (!events.length) return { rosterDiffEvents: 0 };
  const count = await upsertInChunks(
    "rec_league_event_logs",
    dedupeBy(events, (row) => row.event_hash),
    "league_id,event_hash",
    "Failed to upsert roster diff events."
  );
  return { rosterDiffEvents: count };
}

async function commitScheduleEvents(importJobId: string, leagueId: string, teamMap: Map<string, string>, seasonNumber: number) {
  const staged = await loadStagedRows("rec_import_staging_games", importJobId);
  if (!staged.length) return { scheduleEvents: 0 };

  const guildId = await loadGuildIdForLeague(leagueId);
  if (!guildId) return { scheduleEvents: 0, warning: "No guild_id found for schedule update events." };

  const events = staged.map((row: any, index: number) => {
    const away = toNullableText(row.away_team_name) ?? `Away ${row.away_team_external_id ?? ""}`.trim();
    const home = toNullableText(row.home_team_name) ?? `Home ${row.home_team_external_id ?? ""}`.trim();
    const week = Number(row.week_number ?? 0) || null;
    const gameKey = toNullableText(row.external_game_id) ?? `week:${week ?? "na"}:${row.away_team_external_id ?? "away"}:${row.home_team_external_id ?? "home"}:${index}`;
    return {
      guild_id: guildId,
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: row.season_number ?? seasonNumber,
      season_index: row.season_index,
      season_stage: row.season_stage,
      week_number: week,
      source: "ea_import",
      source_endpoint: "schedule",
      event_type: "schedule_update",
      event_category: row.game_status,
      external_event_id: gameKey,
      event_hash: `schedule:${gameKey}`,
      title: `${away} at ${home}`,
      body: `Week ${week ?? "?"}: ${away} at ${home}`,
      team_id: row.home_team_external_id ? teamMap.get(String(row.home_team_external_id)) ?? null : null,
      team_external_id: row.home_team_external_id,
      team_name: home,
      from_team_id: row.away_team_external_id ? teamMap.get(String(row.away_team_external_id)) ?? null : null,
      from_team_external_id: row.away_team_external_id,
      from_team_name: away,
      to_team_id: row.home_team_external_id ? teamMap.get(String(row.home_team_external_id)) ?? null : null,
      to_team_external_id: row.home_team_external_id,
      to_team_name: home,
      payload: row.raw_payload ?? {},
      occurred_at: row.played_at,
      updated_at: new Date().toISOString()
    };
  });

  const count = await upsertInChunks(
    "rec_league_event_logs",
    dedupeBy(events, (row) => row.event_hash),
    "league_id,event_hash",
    "Failed to upsert schedule update events."
  );
  return { scheduleEvents: count };
}

export async function commitApprovedImport(importJobId: string) {
  const details = await getImportJob(importJobId);
  const leagueId = details.job.league_id as string;

  // Resolve the league's season so committed results carry season_number (advance records/payouts
  // filter results by season_number; null would silently match nothing).
  const leagueRow = await supabase.from("rec_leagues").select("season_number,display_season_number").eq("id", leagueId).single();
  if (leagueRow.error) throw new ApiError(500, "Failed to load league for import commit.", leagueRow.error);
  const seasonNumber = Number(leagueRow.data?.season_number ?? leagueRow.data?.display_season_number ?? 1) || 1;

  // Resolve team maps (sequential — each depends on the previous)
  const teams = await upsertTeams(importJobId, leagueId);
  const committedTeamMap = await loadTeamMap(leagueId);
  const stagedTeamMap = await buildTeamMapFromStaging(importJobId, leagueId);
  for (const [externalId, teamId] of stagedTeamMap.entries()) committedTeamMap.set(externalId, teamId);
  for (const [externalId, teamId] of teams.teamMap.entries()) committedTeamMap.set(externalId, teamId);
  const assignmentMap = await loadAssignmentMap(leagueId);

  // Games/results are the critical commit — let failures surface. Standings/players/stats are
  // secondary; isolate them so one failing entity cannot abort the game commit.
  const commitWarnings: string[] = [];
  const safe = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      console.error(`[IMPORT COMMIT] "${name}" failed:`, error);
      commitWarnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  };

  const gameCommit = await upsertGamesAndResults(importJobId, leagueId, committedTeamMap, assignmentMap, seasonNumber);
  const scheduleEvents = await safe("schedule_events", () => commitScheduleEvents(importJobId, leagueId, committedTeamMap, seasonNumber), { scheduleEvents: 0 });
  if ((scheduleEvents as any).warning) commitWarnings.push((scheduleEvents as any).warning);
  const standings = await safe("standings", () => upsertStandings(importJobId, leagueId, committedTeamMap, seasonNumber), 0);
  // Players must commit before weekly stats so the stats' player_id FK lookup can resolve.
  const weekNumber = Number((details.job as any).week_number ?? 1) || 1;
  const rosterDiffEvents = await safe("roster_diff_events", () => commitRosterDiffEvents(importJobId, leagueId, seasonNumber, weekNumber), { rosterDiffEvents: 0 });
  if ((rosterDiffEvents as any).warning) commitWarnings.push((rosterDiffEvents as any).warning);
  const players = await safe("players", () => upsertPlayers(importJobId, leagueId, committedTeamMap, seasonNumber, weekNumber), 0);
  const rosterSnapshots = await safe(
    "roster_snapshots",
    () => refreshRosterSnapshots(importJobId, leagueId, seasonNumber, weekNumber),
    { sourceRows: 0, insertedRows: 0, updatedRows: 0, deactivatedRows: 0, activeSnapshotRows: 0 }
  );
  const stats = await safe("weekly_stats", () => upsertWeeklyStats(importJobId, leagueId, committedTeamMap, seasonNumber), { playerCount: 0, teamCount: 0, unmappedStatKeys: [] as Array<{ key: string; count: number }> });
  const leagueEvents = await safe("league_events", () => commitLeagueFeedEvents(importJobId, leagueId, committedTeamMap), { feedEvents: 0 });
  if ((leagueEvents as any).warning) commitWarnings.push((leagueEvents as any).warning);

  // Warn (non-fatally) when imported stat keys did not map to a canonical REC stat, so the
  // canonical definition map can be expanded. Does not block the import.
  if ((stats.unmappedStatKeys?.length ?? 0) > 0) {
    const top = stats.unmappedStatKeys.slice(0, 10).map((u) => `${u.key} (×${u.count})`).join(", ");
    commitWarnings.push(`Unmapped stat keys (not in canonical map): ${top}`);
  }

  // Auto-backfill W-L-T records whenever completed game results are committed (EA import or
  // companion app export). This keeps season/league/global records current without requiring
  // a separate manual step or waiting until the next advance.
  if (gameCommit.resultsAddedOrUpdated > 0) {
    const guildId = (details.job as any).server?.guild_id;
    if (guildId) {
      await safe("apply_records", () => applyAdvanceRecords(guildId), { applied: 0 });
    }
  }

  const previousSummary = details.job.preview_summary ?? {};
  const committedCounts = {
    teams: teams.addedOrUpdated,
    games: gameCommit.gamesAddedOrUpdated,
    leagueGamesStored: gameCommit.gamesAddedOrUpdated,
    gameResults: gameCommit.resultsAddedOrUpdated,
    gamesSkipped: gameCommit.gamesSkipped,
    scheduleEvents: scheduleEvents.scheduleEvents,
    standings,
    players,
    rosterSnapshots,
    playerWeeklyStats: stats.playerCount,
    teamWeeklyStats: stats.teamCount,
    leagueEvents: leagueEvents.feedEvents,
    rosterDiffEvents: rosterDiffEvents.rosterDiffEvents,
    unmappedStatKeys: stats.unmappedStatKeys ?? [],
    warnings: commitWarnings
  };

  if ((previousSummary as any).gamesFound > 0 && committedCounts.games === 0) {
    throw new ApiError(500, "Schedule import approval failed: staged games were found but no games were written to rec_games.", {
      stagedGameCount: (previousSummary as any).gamesFound,
      committedGameCount: committedCounts.games,
      gamesSkipped: gameCommit.gamesSkipped,
      skippedGames: (gameCommit as any).skippedGames?.slice?.(0, 10) ?? []
    });
  }

  return updateImportJobStatus({
    importJobId,
    status: "completed",
    previewSummary: {
      ...previousSummary,
      approvalStatus: "committed",
      committedCounts,
      committedAt: new Date().toISOString(),
      payouts: "Deferred until league advance. Imports do not issue payouts."
    },
    validationWarnings: details.job.validation_warnings ?? [],
    validationErrors: []
  });
}
