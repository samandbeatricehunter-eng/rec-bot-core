import { NFL_TEAMS } from "@rec/shared";
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

async function upsertStandings(_importJobId: string, _leagueId: string, _teamMap: Map<string, string>) {
  // There is no committed standings table in the deployed schema (standings are derived from
  // rec_game_results / rec_league_user_records during advance). Staged standings remain in
  // rec_import_staging_standings for reference; nothing to commit here.
  return 0;
}

const DEV_TRAIT_TIER: Record<string, number> = { Normal: 0, Star: 1, Superstar: 2, XFactor: 3 };
const DEV_UPGRADE_PRIZE_AMOUNT = 50;

async function upsertPlayers(importJobId: string, leagueId: string, teamMap: Map<string, string>, seasonNumber: number, weekNumber: number) {
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
    const overallRating = toNullableInt(raw.overallRating ?? raw.overall);
    const externalTeamId = toNullableText(raw.teamId ?? raw.rosterId);
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
      raw_payload: row.raw_payload ?? null,
      updated_at: now,
      _externalTeamId: externalTeamId // scratch field for upgrade detection, stripped before upsert
    };
  }).filter((p) => p.madden_player_id && p.full_name);

  // rec_players has UNIQUE (league_id, madden_player_id); one chunked bulk upsert handles both
  // insert and update. Dedupe on madden_player_id first so a chunk can't target the same key twice.
  const deduped = dedupeBy(playerRows, (r) => String(r.madden_player_id));

  // Detect dev trait upgrades before upserting (compare new values vs existing).
  const maddenIds = deduped.map((r) => r.madden_player_id).filter(Boolean);
  let prevDevTraitMap = new Map<string, string>();
  if (maddenIds.length > 0) {
    const { data: existing } = await supabase.from("rec_players").select("madden_player_id,dev_trait").eq("league_id", leagueId).in("madden_player_id", maddenIds);
    for (const e of existing ?? []) {
      if (e.madden_player_id && e.dev_trait) prevDevTraitMap.set(String(e.madden_player_id), String(e.dev_trait));
    }
  }

  // Strip scratch field before upsert
  const rowsForUpsert = deduped.map(({ _externalTeamId: _ext, ...rest }) => rest);
  const count = await upsertInChunks("rec_players", rowsForUpsert, "league_id,madden_player_id", "Failed to upsert imported players.");

  // Queue dev upgrade prize events for any player whose dev trait improved this import.
  const upgradeEvents: any[] = [];
  for (const row of deduped) {
    const mid = String(row.madden_player_id);
    const prevTrait = prevDevTraitMap.get(mid);
    const newTrait = row.dev_trait;
    if (!prevTrait || !newTrait) continue;
    const prevTier = DEV_TRAIT_TIER[prevTrait] ?? -1;
    const newTier = DEV_TRAIT_TIER[newTrait] ?? -1;
    if (newTier <= prevTier) continue;
    // Resolve team and user for the prize
    const externalTeamId = row._externalTeamId ?? null;
    const teamId = externalTeamId ? (teamMap.get(String(externalTeamId)) ?? null) : null;
    let userId: string | null = null;
    if (teamId) {
      const { data: assignment } = await supabase.from("rec_team_assignments").select("user_id").eq("team_id", teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
      userId = assignment?.user_id ?? null;
    }
    upgradeEvents.push({
      league_id: leagueId,
      user_id: userId,
      team_id: teamId,
      season_number: seasonNumber,
      week_number: weekNumber,
      player_name: row.full_name,
      madden_player_id: mid,
      old_dev_trait: prevTrait,
      new_dev_trait: newTrait,
      prize_amount: DEV_UPGRADE_PRIZE_AMOUNT,
      issued: false,
      import_job_id: importJobId,
      created_at: now
    });
  }
  if (upgradeEvents.length > 0) {
    // Idempotent: skip if same player already has an unissued event for this import job
    try { await supabase.from("rec_dev_upgrade_prizes").upsert(upgradeEvents, { onConflict: "league_id,import_job_id,madden_player_id", ignoreDuplicates: true }); } catch { /* non-fatal */ }
  }

  return count;
}

async function upsertWeeklyStats(importJobId: string, leagueId: string, teamMap: Map<string, string>, seasonNumber: number) {
  const [playerStats, teamStats] = await Promise.all([
    loadStagedRows("rec_import_staging_player_stats", importJobId),
    loadStagedRows("rec_import_staging_team_stats", importJobId)
  ]);

  const now = new Date().toISOString();

  // ---- Player stats → rec_player_weekly_stats (keyed on madden_player_id) ----
  const playerStatRows = (playerStats as any[]).map((row: any) => {
    const maddenPlayerId = toNullableText(row.player_external_id ?? row.external_player_id);
    const maddenTeamId = toNullableText(row.team_external_id ?? row.external_team_id);
    return {
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: seasonNumber,
      season_stage: row.season_stage ?? "regular_season",
      week_number: row.week_number ?? null,
      player_id: null as string | null, // filled below after bulk lookup
      team_id: maddenTeamId ? teamMap.get(maddenTeamId) ?? null : null,
      madden_player_id: maddenPlayerId,
      madden_team_id: maddenTeamId,
      player_name: row.player_name ?? row.player_display_name ?? null,
      team_name: row.team_name ?? row.team_display_name ?? null,
      position: row.position ?? null,
      stat_category: row.stat_category ?? "general",
      stats: row.stats ?? {},
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

  // rec_player_weekly_stats has UNIQUE (league_id, season_number, season_stage, week_number,
  // madden_player_id, stat_category); a chunked bulk upsert handles insert and update together.
  const dedupedPS = dedupeBy(playerStatRows, (r) => `${r.season_number}|${r.season_stage}|${r.week_number}|${r.madden_player_id}|${r.stat_category}`);
  const playerCount = await upsertInChunks(
    "rec_player_weekly_stats", dedupedPS,
    "league_id,season_number,season_stage,week_number,madden_player_id,stat_category",
    "Failed to upsert imported player weekly stats."
  );

  // ---- Team stats → rec_team_weekly_stats (keyed on madden_team_id) ----
  const teamStatRows = (teamStats as any[]).map((row: any) => {
    const maddenTeamId = toNullableText(row.team_external_id ?? row.external_team_id);
    return {
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: seasonNumber,
      season_stage: row.season_stage ?? "regular_season",
      week_number: row.week_number ?? null,
      team_id: maddenTeamId ? teamMap.get(maddenTeamId) ?? null : null,
      madden_team_id: maddenTeamId,
      team_name: row.team_name ?? row.team_display_name ?? null,
      stat_category: row.stat_category ?? "general",
      stats: row.stats ?? {},
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

  return { playerCount, teamCount };
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
  const standings = await safe("standings", () => upsertStandings(importJobId, leagueId, committedTeamMap), 0);
  // Players must commit before weekly stats so the stats' player_id FK lookup can resolve.
  const weekNumber = Number((details.job as any).week_number ?? 1) || 1;
  const players = await safe("players", () => upsertPlayers(importJobId, leagueId, committedTeamMap, seasonNumber, weekNumber), 0);
  const stats = await safe("weekly_stats", () => upsertWeeklyStats(importJobId, leagueId, committedTeamMap, seasonNumber), { playerCount: 0, teamCount: 0 });

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
    standings,
    players,
    playerWeeklyStats: stats.playerCount,
    teamWeeklyStats: stats.teamCount,
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
