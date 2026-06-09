import { NFL_TEAMS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
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
function isFinalScore(homeScore: unknown, awayScore: unknown) { return Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore)); }
function gamePhase(weekNumber: number | null | undefined, seasonStage?: string | null) { if (seasonStage && seasonStage !== "regular_season") return seasonStage === "super_bowl" ? "playoffs" : seasonStage; if (!weekNumber || weekNumber <= 18) return "regular_season"; return "playoffs"; }
function gameStatus(row: any) { if (isFinalScore(row.home_score, row.away_score)) return "completed"; const status = String(row.game_status ?? "scheduled").toLowerCase(); return status === "complete" || status === "completed" ? "completed" : "scheduled"; }
function collectPrefixed(raw: JsonObject, suffixes: string[]) { const out: JsonObject = {}; for (const [key, value] of Object.entries(raw)) if (suffixes.some((suffix) => key.endsWith(suffix))) out[key] = value; return out; }
function buildRatings(raw: JsonObject) { return collectPrefixed(raw, ["Rating", "Grade"]); }
function buildTraits(raw: JsonObject) { return collectPrefixed(raw, ["Trait"]); }
function buildContract(raw: JsonObject) { const keys = ["capHit", "capReleaseNetSavings", "capReleasePenalty", "contractBonus", "contractSalary", "contractYearsLeft", "contractLength", "desiredBonus", "desiredSalary", "desiredLength", "reSignStatus"]; return Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]])); }

async function loadStagedRows(table: string, importJobId: string) {
  const result = await supabase.from(table).select("*").eq("import_job_id", importJobId);
  if (result.error) throw new ApiError(500, `Failed to load ${table}.`, result.error);
  return result.data ?? [];
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
    const existing = await supabase
      .from("rec_games")
      .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase")
      .eq("league_id", leagueId)
      .in("external_game_id", allExternalGameIds);
    if (existing.error) throw new ApiError(500, "Failed to bulk-load existing games.", existing.error);
    for (const g of existing.data ?? []) {
      if (g.external_game_id) existingGamesByExternalId.set(g.external_game_id, g as CommittedGameRow);
    }
  }

  const toInsertGames = gameRows.filter((r) => !existingGamesByExternalId.has(r.external_game_id));
  const toUpdateGames = gameRows.filter((r) => existingGamesByExternalId.has(r.external_game_id));

  const savedGames: CommittedGameRow[] = [];

  // Batch insert new games
  if (toInsertGames.length > 0) {
    const inserted = await supabase
      .from("rec_games")
      .insert(toInsertGames)
      .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase");
    if (inserted.error) throw new ApiError(500, "Failed to batch-insert imported games.", inserted.error);
    savedGames.push(...((inserted.data ?? []) as CommittedGameRow[]));
  }

  // Parallel update existing games
  if (toUpdateGames.length > 0) {
    const updateResults = await Promise.all(
      toUpdateGames.map((row) => {
        const existing = existingGamesByExternalId.get(row.external_game_id)!;
        return supabase
          .from("rec_games")
          .update(row)
          .eq("id", existing.id)
          .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase")
          .single();
      })
    );
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
    const existingResults = await supabase
      .from("rec_game_results")
      .select("id,external_game_id")
      .eq("league_id", leagueId)
      .in("external_game_id", completedExternalIds);
    if (existingResults.error) throw new ApiError(500, "Failed to bulk-load existing game results.", existingResults.error);
    for (const r of existingResults.data ?? []) {
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
      const inserted = await supabase.from("rec_game_results").insert(toInsertResults).select("id");
      if (inserted.error) throw new ApiError(500, "Failed to batch-insert imported game results.", inserted.error);
      resultsAddedOrUpdated += inserted.data?.length ?? 0;
    }

    // Parallel update existing results
    if (toUpdateResults.length > 0) {
      const updateResults = await Promise.all(
        toUpdateResults.map((row) => {
          const existingId = existingResultsByExternalId.get(row.external_game_id!)!;
          return supabase.from("rec_game_results").update(row).eq("id", existingId).select("id").single();
        })
      );
      for (const result of updateResults) {
        if (result.error) throw new ApiError(500, "Failed to update imported game result.", result.error);
        if (result.data) resultsAddedOrUpdated++;
      }
    }
  }

  return { gamesAddedOrUpdated: savedGames.length, resultsAddedOrUpdated, gamesSkipped: skipped.length, skippedGames: skipped };
}

async function upsertStandings(importJobId: string, leagueId: string, _teamMap: Map<string, string>) {
  // There is no committed standings table in the deployed schema (standings are derived from
  // rec_game_results / rec_league_user_records during advance). Staged standings remain in
  // rec_import_staging_standings for reference; nothing to commit here.
  const staged = await loadStagedRows("rec_import_staging_standings", importJobId);
  return staged.length === 0 ? 0 : 0;
}

async function upsertPlayers(importJobId: string, leagueId: string, teamMap: Map<string, string>) {
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
      raw_payload: row.raw_payload ?? null,
      updated_at: now
    };
  }).filter((p) => p.madden_player_id && p.full_name);

  // Bulk load existing players by madden_player_id
  const maddenIds = playerRows.map((r) => r.madden_player_id).filter(Boolean) as string[];
  const existingById = new Map<string, string>();

  if (maddenIds.length > 0) {
    const existing = await supabase.from("rec_players").select("id,madden_player_id").eq("league_id", leagueId).in("madden_player_id", maddenIds);
    if (existing.error) throw new ApiError(500, "Failed to bulk-load existing players.", existing.error);
    for (const p of existing.data ?? []) {
      if (p.madden_player_id) existingById.set(String(p.madden_player_id), p.id);
    }
  }

  const toInsert = playerRows.filter((r) => !existingById.has(String(r.madden_player_id)));
  const toUpdate = playerRows.filter((r) => existingById.has(String(r.madden_player_id)));

  let count = 0;

  if (toInsert.length > 0) {
    const inserted = await supabase.from("rec_players").insert(toInsert).select("id");
    if (inserted.error) throw new ApiError(500, "Failed to batch-insert imported players.", inserted.error);
    count += inserted.data?.length ?? 0;
  }

  if (toUpdate.length > 0) {
    const results = await Promise.all(
      toUpdate.map((row) => {
        const id = existingById.get(String(row.madden_player_id))!;
        return supabase.from("rec_players").update(row).eq("id", id).select("id").single();
      })
    );
    for (const result of results) {
      if (result.error) throw new ApiError(500, "Failed to update imported player.", result.error);
      if (result.data) count++;
    }
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
    const pResult = await supabase.from("rec_players").select("id,madden_player_id").eq("league_id", leagueId).in("madden_player_id", statMaddenIds);
    if (!pResult.error) {
      for (const p of pResult.data ?? []) if (p.madden_player_id) playerIdByMaddenId.set(String(p.madden_player_id), p.id);
    }
  }
  for (const row of playerStatRows) {
    if (row.madden_player_id) row.player_id = playerIdByMaddenId.get(String(row.madden_player_id)) ?? null;
  }

  // Dedup existing player stats by (madden_player_id, week, category)
  const existingPlayerStatIds = new Map<string, string>();
  if (statMaddenIds.length > 0) {
    const existing = await supabase
      .from("rec_player_weekly_stats")
      .select("id,madden_player_id,week_number,stat_category")
      .eq("league_id", leagueId)
      .in("madden_player_id", statMaddenIds);
    if (!existing.error) {
      for (const r of existing.data ?? []) {
        existingPlayerStatIds.set(`${r.madden_player_id}|${r.week_number}|${r.stat_category}`, r.id);
      }
    }
  }

  const toInsertPS = playerStatRows.filter((r) => !existingPlayerStatIds.has(`${r.madden_player_id}|${r.week_number}|${r.stat_category}`));
  const toUpdatePS = playerStatRows.filter((r) => existingPlayerStatIds.has(`${r.madden_player_id}|${r.week_number}|${r.stat_category}`));

  let playerCount = 0;
  if (toInsertPS.length > 0) {
    const result = await supabase.from("rec_player_weekly_stats").insert(toInsertPS).select("id");
    if (result.error) throw new ApiError(500, "Failed to batch-insert imported player weekly stats.", result.error);
    playerCount += result.data?.length ?? 0;
  }
  if (toUpdatePS.length > 0) {
    const results = await Promise.all(
      toUpdatePS.map((row) => {
        const id = existingPlayerStatIds.get(`${row.madden_player_id}|${row.week_number}|${row.stat_category}`)!;
        return supabase.from("rec_player_weekly_stats").update(row).eq("id", id).select("id").single();
      })
    );
    for (const result of results) {
      if (result.error) throw new ApiError(500, "Failed to update imported player weekly stat.", result.error);
      if (result.data) playerCount++;
    }
  }

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

  const teamStatMaddenIds = [...new Set(teamStatRows.map((r) => r.madden_team_id).filter(Boolean))] as string[];
  const existingTeamStatIds = new Map<string, string>();
  if (teamStatMaddenIds.length > 0) {
    const existing = await supabase
      .from("rec_team_weekly_stats")
      .select("id,madden_team_id,week_number,stat_category")
      .eq("league_id", leagueId)
      .in("madden_team_id", teamStatMaddenIds);
    if (!existing.error) {
      for (const r of existing.data ?? []) {
        existingTeamStatIds.set(`${r.madden_team_id}|${r.week_number}|${r.stat_category}`, r.id);
      }
    }
  }

  const toInsertTS = teamStatRows.filter((r) => !existingTeamStatIds.has(`${r.madden_team_id}|${r.week_number}|${r.stat_category}`));
  const toUpdateTS = teamStatRows.filter((r) => existingTeamStatIds.has(`${r.madden_team_id}|${r.week_number}|${r.stat_category}`));

  let teamCount = 0;
  if (toInsertTS.length > 0) {
    const result = await supabase.from("rec_team_weekly_stats").insert(toInsertTS).select("id");
    if (result.error) throw new ApiError(500, "Failed to batch-insert imported team weekly stats.", result.error);
    teamCount += result.data?.length ?? 0;
  }
  if (toUpdateTS.length > 0) {
    const results = await Promise.all(
      toUpdateTS.map((row) => {
        const id = existingTeamStatIds.get(`${row.madden_team_id}|${row.week_number}|${row.stat_category}`)!;
        return supabase.from("rec_team_weekly_stats").update(row).eq("id", id).select("id").single();
      })
    );
    for (const result of results) {
      if (result.error) throw new ApiError(500, "Failed to update imported team weekly stat.", result.error);
      if (result.data) teamCount++;
    }
  }

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
  const [standings, players, stats] = await Promise.all([
    safe("standings", () => upsertStandings(importJobId, leagueId, committedTeamMap), 0),
    safe("players", () => upsertPlayers(importJobId, leagueId, committedTeamMap), 0),
    safe("weekly_stats", () => upsertWeeklyStats(importJobId, leagueId, committedTeamMap, seasonNumber), { playerCount: 0, teamCount: 0 })
  ]);

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
