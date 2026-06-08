import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getImportJob, updateImportJobStatus } from "./import.service.js";

type JsonObject = Record<string, unknown>;

type TeamRow = {
  id: string;
  name?: string | null;
  madden_team_id: string | null;
};

type AssignmentRow = {
  team_id: string;
  user_id: string | null;
};

type CommittedGameRow = {
  id: string;
  external_game_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_user_id: string | null;
  away_user_id: string | null;
  home_score: number | null;
  away_score: number | null;
  week_number: number | null;
  phase: string | null;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function teamExternalId(row: any) {
  const raw = asObject(row.raw_payload);
  const normalized = asObject(row.normalized);
  return toNullableText(
    row.team_external_id ??
    row.external_team_id ??
    row.madden_team_id ??
    normalized.teamId ??
    raw.teamId ??
    raw.id ??
    raw.rosterId
  );
}

function gameTeamExternalId(row: any, side: "home" | "away") {
  const raw = asObject(row.raw_payload);
  return toNullableText(
    side === "home"
      ? row.home_team_external_id ?? raw.homeTeamId ?? (asObject(raw.home).teamId) ?? (asObject(raw.seasonGameInfo).homeTeamId)
      : row.away_team_external_id ?? raw.awayTeamId ?? (asObject(raw.away).teamId) ?? (asObject(raw.seasonGameInfo).awayTeamId)
  );
}

function normalizeTeamName(value: unknown, fallback: string) {
  const text = toNullableText(value);
  if (!text) return fallback;
  return /^\s*(Home|Away) Team \d+\s*$/i.test(text) ? fallback : text;
}

function stagedTeamDisplayName(row: any) {
  const raw = asObject(row.raw_payload);
  const cityNick = [raw.cityName, raw.nickName].map(toNullableText).filter(Boolean).join(" ");
  return normalizeTeamName(
    cityNick || row.team_name || row.team_display_name || raw.displayName || raw.nickName || raw.abbrName,
    `Team ${teamExternalId(row) ?? "Unknown"}`
  );
}

function normalizedLookup(value: unknown) {
  const text = toNullableText(value);
  return text ? text.toLowerCase().replace(/[^a-z0-9]/g, "") : null;
}

function toNullableText(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function isFinalScore(homeScore: unknown, awayScore: unknown) {
  return Number.isFinite(Number(homeScore)) && Number.isFinite(Number(awayScore));
}

function gamePhase(weekNumber: number | null | undefined, seasonStage?: string | null) {
  if (seasonStage && seasonStage !== "regular_season") return seasonStage === "super_bowl" ? "playoffs" : seasonStage;
  if (!weekNumber || weekNumber <= 18) return "regular_season";
  return "playoffs";
}

function gameStatus(row: any) {
  if (isFinalScore(row.home_score, row.away_score)) return "completed";
  const status = String(row.game_status ?? "scheduled").toLowerCase();
  return status === "complete" || status === "completed" ? "completed" : "scheduled";
}

function collectPrefixed(raw: JsonObject, suffixes: string[]) {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(raw)) {
    if (suffixes.some((suffix) => key.endsWith(suffix))) out[key] = value;
  }
  return out;
}

function buildRatings(raw: JsonObject) {
  return collectPrefixed(raw, ["Rating", "Grade"]);
}

function buildTraits(raw: JsonObject) {
  return collectPrefixed(raw, ["Trait"]);
}

function buildContract(raw: JsonObject) {
  const keys = [
    "capHit",
    "capReleaseNetSavings",
    "capReleasePenalty",
    "contractBonus",
    "contractSalary",
    "contractYearsLeft",
    "contractLength",
    "desiredBonus",
    "desiredSalary",
    "desiredLength",
    "reSignStatus"
  ];
  return Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]]));
}

async function loadStagedRows(table: string, importJobId: string) {
  const result = await supabase.from(table).select("*").eq("import_job_id", importJobId);
  if (result.error) throw new ApiError(500, `Failed to load ${table}.`, result.error);
  return result.data ?? [];
}

async function upsertTeams(importJobId: string, leagueId: string) {
  const stagedTeams = await loadStagedRows("rec_import_staging_teams", importJobId);
  if (stagedTeams.length === 0) return { addedOrUpdated: 0, teamMap: new Map<string, string>() };

  const rows = (stagedTeams as any[])
    .map((team: any) => {
      const raw = asObject(team.raw_payload);
      const maddenTeamId = teamExternalId(team);
      const name = stagedTeamDisplayName(team);

      return {
        league_id: leagueId,
        name,
        abbreviation: team.abbr_name ?? team.abbreviation ?? raw.abbrName ?? null,
        conference: team.conference ?? raw.conferenceName ?? null,
        division: team.division_name ?? raw.divName ?? null,
        madden_team_id: maddenTeamId,
        source: "madden_companion_export",
        updated_at: new Date().toISOString()
      };
    })
    .filter((team) => team.name && team.madden_team_id);

  const teamMap = new Map<string, string>();
  let addedOrUpdated = 0;

  for (const row of rows) {
    const existingByName = await supabase
      .from("rec_teams")
      .select("id,name,madden_team_id")
      .eq("league_id", leagueId)
      .or(`name.eq.${row.name},madden_team_id.eq.${row.madden_team_id}`)
      .maybeSingle();

    if (existingByName.error) throw new ApiError(500, "Failed to check imported team by name.", existingByName.error);

    const saved = existingByName.data?.id
      ? await supabase
        .from("rec_teams")
        .update(row)
        .eq("id", existingByName.data.id)
        .select("id,name,madden_team_id")
        .single()
      : await supabase
        .from("rec_teams")
        .insert(row)
        .select("id,name,madden_team_id")
        .single();

    if (saved.error) throw new ApiError(500, "Failed to commit imported team.", saved.error);
    if (saved.data?.madden_team_id) teamMap.set(String(saved.data.madden_team_id), String(saved.data.id));
    addedOrUpdated += saved.data ? 1 : 0;
  }

  return { addedOrUpdated, teamMap };
}

async function loadTeamMap(leagueId: string) {
  const result = await supabase
    .from("rec_teams")
    .select("id,madden_team_id")
    .eq("league_id", leagueId)
    .not("madden_team_id", "is", null);

  if (result.error) throw new ApiError(500, "Failed to load committed team map.", result.error);

  const teamMap = new Map<string, string>();
  for (const team of (result.data ?? []) as TeamRow[]) {
    if (team.madden_team_id) teamMap.set(String(team.madden_team_id), team.id);
  }
  return teamMap;
}

async function buildTeamMapFromStaging(importJobId: string, leagueId: string) {
  const stagedTeams = await loadStagedRows("rec_import_staging_teams", importJobId);
  if (stagedTeams.length === 0) return new Map<string, string>();

  const committedTeams = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,madden_team_id")
    .eq("league_id", leagueId);

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

  for (const staged of stagedTeams as any[]) {
    const raw = asObject(staged.raw_payload);
    const externalId = teamExternalId(staged);
    if (!externalId) continue;

    const name = stagedTeamDisplayName(staged);
    const abbr = staged.abbr_name ?? staged.abbreviation ?? raw.abbrName;
    const committed = byName.get(normalizedLookup(name) ?? "") ?? byAbbr.get(normalizedLookup(abbr) ?? "");

    if (committed?.id) {
      map.set(String(externalId), committed.id);
      if (!committed.madden_team_id) {
        await supabase.from("rec_teams").update({ madden_team_id: String(externalId), updated_at: new Date().toISOString() }).eq("id", committed.id);
      }
    }
  }

  return map;
}

async function loadAssignmentMap(leagueId: string) {
  const result = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (result.error) throw new ApiError(500, "Failed to load active team assignments.", result.error);

  const assignmentMap = new Map<string, string>();
  for (const assignment of (result.data ?? []) as AssignmentRow[]) {
    if (assignment.team_id && assignment.user_id) assignmentMap.set(assignment.team_id, assignment.user_id);
  }
  return assignmentMap;
}

async function upsertGamesAndResults(importJobId: string, leagueId: string, teamMap: Map<string, string>, assignmentMap: Map<string, string>) {
  const stagedGames = await loadStagedRows("rec_import_staging_games", importJobId);
  if (stagedGames.length === 0) return { gamesAddedOrUpdated: 0, resultsAddedOrUpdated: 0, gamesSkipped: 0 };

  const gameRows = [];
  const skipped = [];

  for (const game of stagedGames as any[]) {
    const homeExternalId = gameTeamExternalId(game, "home");
    const awayExternalId = gameTeamExternalId(game, "away");
    let homeTeamId = homeExternalId ? teamMap.get(String(homeExternalId)) ?? null : null;
    let awayTeamId = awayExternalId ? teamMap.get(String(awayExternalId)) ?? null : null;

    if (!homeTeamId && homeExternalId) {
      const fallbackName = normalizeTeamName(game.home_team_name, `Home Team ${homeExternalId}`);
      const existingFallback = await supabase
        .from("rec_teams")
        .select("id")
        .eq("league_id", leagueId)
        .eq("madden_team_id", String(homeExternalId))
        .maybeSingle();
      if (existingFallback.error) throw new ApiError(500, "Failed to check fallback home team for imported game.", existingFallback.error);
      const inserted = existingFallback.data?.id ? { data: existingFallback.data, error: null } as any : await supabase
        .from("rec_teams")
        .insert({
          league_id: leagueId,
          name: fallbackName,
          abbreviation: null,
          madden_team_id: String(homeExternalId),
          source: "madden_companion_export",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();
      if (inserted.error) throw new ApiError(500, "Failed to create fallback home team for imported game.", inserted.error);
      homeTeamId = inserted.data?.id ?? null;
      if (homeTeamId) teamMap.set(String(homeExternalId), homeTeamId);
    }

    if (!awayTeamId && awayExternalId) {
      const fallbackName = normalizeTeamName(game.away_team_name, `Away Team ${awayExternalId}`);
      const existingFallback = await supabase
        .from("rec_teams")
        .select("id")
        .eq("league_id", leagueId)
        .eq("madden_team_id", String(awayExternalId))
        .maybeSingle();
      if (existingFallback.error) throw new ApiError(500, "Failed to check fallback away team for imported game.", existingFallback.error);
      const inserted = existingFallback.data?.id ? { data: existingFallback.data, error: null } as any : await supabase
        .from("rec_teams")
        .insert({
          league_id: leagueId,
          name: fallbackName,
          abbreviation: null,
          madden_team_id: String(awayExternalId),
          source: "madden_companion_export",
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();
      if (inserted.error) throw new ApiError(500, "Failed to create fallback away team for imported game.", inserted.error);
      awayTeamId = inserted.data?.id ?? null;
      if (awayTeamId) teamMap.set(String(awayExternalId), awayTeamId);
    }

    if (!homeTeamId || !awayTeamId) {
      skipped.push({
        externalGameId: game.external_game_id ?? String(asObject(game.raw_payload).scheduleId ?? ""),
        homeExternalId,
        awayExternalId,
        reason: "unresolved_team"
      });
      continue;
    }

    const status = gameStatus(game);
    const phase = gamePhase(game.week_number, game.season_stage);

    gameRows.push({
      league_id: leagueId,
      week_number: game.week_number ?? null,
      phase,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      home_user_id: assignmentMap.get(homeTeamId) ?? null,
      away_user_id: assignmentMap.get(awayTeamId) ?? null,
      home_score: isFinalScore(game.home_score, game.away_score) ? toNumber(game.home_score) : null,
      away_score: isFinalScore(game.home_score, game.away_score) ? toNumber(game.away_score) : null,
      status,
      source: "madden_companion_export",
      import_verified: true,
      manual_entered: false,
      result_payout_eligible: status === "completed",
      eos_payout_eligible: true,
      external_game_id: game.external_game_id ?? String(asObject(game.raw_payload).scheduleId ?? ''),
      locked: false,
      updated_at: new Date().toISOString()
    });
  }

  const committedRows: CommittedGameRow[] = [];

  for (const row of gameRows) {
    const existing = row.external_game_id
      ? await supabase
        .from("rec_games")
        .select("id")
        .eq("league_id", leagueId)
        .eq("external_game_id", row.external_game_id)
        .maybeSingle()
      : { data: null, error: null } as any;

    if (existing.error) throw new ApiError(500, "Failed to check existing imported game.", existing.error);

    const saved = existing.data?.id
      ? await supabase
        .from("rec_games")
        .update(row)
        .eq("id", existing.data.id)
        .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase")
        .single()
      : await supabase
        .from("rec_games")
        .insert(row)
        .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase")
        .single();

    if (saved.error) throw new ApiError(500, "Failed to commit imported game.", saved.error);
    if (saved.data) committedRows.push(saved.data as CommittedGameRow);
  }

  if (stagedGames.length > 0 && gameRows.length > 0 && committedRows.length === 0) {
    throw new ApiError(500, "No imported games were committed even though staged games were available.", {
      stagedGames: stagedGames.length,
      commitRowsPrepared: gameRows.length,
      skippedGames: skipped.length
    });
  }

  const gameByExternalId = new Map<string, CommittedGameRow>(
    committedRows
      .filter((game) => game.external_game_id)
      .map((game) => [String(game.external_game_id), game])
  );
  const resultRows = [];

  for (const staged of stagedGames as any[]) {
    const stagedExternalGameId = staged.external_game_id ?? String(asObject(staged.raw_payload).scheduleId ?? '');
    if (!isFinalScore(staged.home_score, staged.away_score) || !stagedExternalGameId) continue;
    const committed = gameByExternalId.get(String(stagedExternalGameId));
    if (!committed) continue;

    const homeScore = toNumber(staged.home_score);
    const awayScore = toNumber(staged.away_score);
    const isTie = homeScore === awayScore;
    const homeWon = homeScore > awayScore;
    const phase = gamePhase(staged.week_number, staged.season_stage);

    resultRows.push({
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: staged.season_number ?? null,
      week_number: staged.week_number ?? null,
      game_type: phase,
      external_game_id: stagedExternalGameId,
      home_team_id: committed.home_team_id,
      away_team_id: committed.away_team_id,
      home_user_id: committed.home_user_id,
      away_user_id: committed.away_user_id,
      home_score: homeScore,
      away_score: awayScore,
      winning_user_id: isTie ? null : homeWon ? committed.home_user_id : committed.away_user_id,
      losing_user_id: isTie ? null : homeWon ? committed.away_user_id : committed.home_user_id,
      winning_team_id: isTie ? null : homeWon ? committed.home_team_id : committed.away_team_id,
      losing_team_id: isTie ? null : homeWon ? committed.away_team_id : committed.home_team_id,
      is_user_h2h: Boolean(committed.home_user_id && committed.away_user_id),
      is_playoff: Number(staged.week_number ?? 0) >= 19,
      is_super_bowl: Number(staged.week_number ?? 0) === 23 || staged.season_stage === "super_bowl",
      is_cpu_game: !(committed.home_user_id && committed.away_user_id),
      is_tie: isTie,
      played_at: staged.played_at ?? null,
      source: "madden_companion_export",
      raw_payload: staged.raw_payload ?? {},
      updated_at: new Date().toISOString()
    });
  }

  const upsertedResults = resultRows.length
    ? await supabase
      .from("rec_game_results")
      .insert(resultRows)
      .select("id")
    : { data: [], error: null } as any;

  if (upsertedResults.error) throw new ApiError(500, "Failed to commit imported game results.", upsertedResults.error);

  return {
    gamesAddedOrUpdated: committedRows.length,
    resultsAddedOrUpdated: upsertedResults.data?.length ?? 0,
    gamesSkipped: skipped.length,
    skippedGames: skipped.slice(0, 25)
  };
}

async function upsertPlayersAndRosterSnapshots(importJobId: string, leagueId: string, teamMap: Map<string, string>) {
  const stagedRosters = await loadStagedRows("rec_import_staging_rosters", importJobId);
  if (stagedRosters.length === 0) return { playersAddedOrUpdated: 0, rosterSnapshotsAddedOrUpdated: 0 };

  const playerRows = (stagedRosters as any[]).map((player) => {
    const raw = asObject(player.raw_payload);
    return {
      league_id: leagueId,
      madden_player_id: String(player.player_external_id),
      first_name: player.first_name ?? raw.firstName ?? null,
      last_name: player.last_name ?? raw.lastName ?? null,
      full_name: player.player_name ?? raw.fullName ?? ([player.first_name, player.last_name].filter(Boolean).join(" ") || null),
      position: player.position ?? raw.position ?? null,
      birth_year: toNullableInt(raw.birthYear),
      college: toNullableText(raw.college),
      height_inches: toNullableInt(raw.height),
      weight_lbs: toNullableInt(raw.weight),
      raw_payload: raw,
      updated_at: new Date().toISOString()
    };
  });

  const upsertedPlayers = await supabase
    .from("rec_players")
    .upsert(playerRows, { onConflict: "league_id,madden_player_id" })
    .select("id,madden_player_id");

  if (upsertedPlayers.error) throw new ApiError(500, "Failed to commit imported players.", upsertedPlayers.error);

  const playerMap = new Map((upsertedPlayers.data ?? []).map((player: any) => [String(player.madden_player_id), String(player.id)]));

  const snapshotRows = (stagedRosters as any[]).map((player) => {
    const raw = asObject(player.raw_payload);
    const maddenTeamId = toNullableText(player.team_external_id);
    const teamId = maddenTeamId ? teamMap.get(maddenTeamId) ?? null : null;
    const maddenPlayerId = String(player.player_external_id);

    return {
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: player.season_number ?? null,
      season_index: player.season_index ?? null,
      week_number: player.week_number ?? null,
      team_id: teamId,
      player_id: playerMap.get(maddenPlayerId) ?? null,
      madden_team_id: maddenTeamId,
      madden_player_id: maddenPlayerId,
      player_name: player.player_name ?? raw.fullName ?? null,
      position: player.position ?? raw.position ?? null,
      jersey_number: player.jersey_number ?? toNullableInt(raw.jerseyNum),
      overall_rating: player.overall_rating ?? toNullableInt(raw.playerBestOvr ?? raw.overallRating ?? raw.ovrRating),
      age: player.age ?? toNullableInt(raw.age),
      dev_trait: player.dev_trait ?? toNullableText(raw.devTrait),
      is_free_agent: Boolean(raw.isFreeAgent) || !teamId,
      is_active: typeof raw.isActive === "boolean" ? raw.isActive : null,
      is_on_ir: typeof raw.isOnIR === "boolean" ? raw.isOnIR : null,
      is_on_practice_squad: typeof raw.isOnPracticeSquad === "boolean" ? raw.isOnPracticeSquad : null,
      contract_salary: toNullableInt(raw.contractSalary),
      contract_bonus: toNullableInt(raw.contractBonus),
      contract_years_left: toNullableInt(raw.contractYearsLeft),
      ratings: buildRatings(raw),
      traits: buildTraits(raw),
      contract: buildContract(raw),
      raw_payload: raw,
      updated_at: new Date().toISOString()
    };
  });

  const upsertedSnapshots = await supabase
    .from("rec_roster_snapshots")
    .upsert(snapshotRows, { onConflict: "league_id,import_job_id,madden_player_id" })
    .select("id");

  if (upsertedSnapshots.error) throw new ApiError(500, "Failed to commit imported roster snapshots.", upsertedSnapshots.error);

  return {
    playersAddedOrUpdated: upsertedPlayers.data?.length ?? 0,
    rosterSnapshotsAddedOrUpdated: upsertedSnapshots.data?.length ?? 0
  };
}

async function upsertPlayerWeeklyStats(importJobId: string, leagueId: string, teamMap: Map<string, string>) {
  const stagedStats = await loadStagedRows("rec_import_staging_player_stats", importJobId);
  if (stagedStats.length === 0) return { playerStatsAddedOrUpdated: 0 };

  const playerIds = Array.from(new Set((stagedStats as any[]).map((row) => String(row.player_external_id)).filter(Boolean)));
  let playerMap = new Map<string, string>();

  if (playerIds.length) {
    const players = await supabase
      .from("rec_players")
      .select("id,madden_player_id")
      .eq("league_id", leagueId)
      .in("madden_player_id", playerIds);

    if (players.error) throw new ApiError(500, "Failed to resolve player stat players.", players.error);
    playerMap = new Map((players.data ?? []).map((player: any) => [String(player.madden_player_id), String(player.id)]));
  }

  const rows = (stagedStats as any[]).map((stat) => {
    const maddenTeamId = toNullableText(stat.team_external_id);
    const maddenPlayerId = String(stat.player_external_id);
    return {
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: stat.season_number ?? null,
      season_index: stat.season_index ?? null,
      season_stage: stat.season_stage ?? "regular_season",
      week_number: stat.week_number ?? null,
      player_id: playerMap.get(maddenPlayerId) ?? null,
      team_id: maddenTeamId ? teamMap.get(maddenTeamId) ?? null : null,
      madden_player_id: maddenPlayerId,
      madden_team_id: maddenTeamId,
      player_name: stat.player_name ?? null,
      team_name: stat.team_name ?? null,
      position: stat.position ?? null,
      stat_category: stat.stat_category ?? "unknown",
      stats: stat.stats ?? {},
      raw_payload: stat.raw_payload ?? {},
      updated_at: new Date().toISOString()
    };
  });

  const upserted = await supabase
    .from("rec_player_weekly_stats")
    .upsert(rows, { onConflict: "league_id,season_number,season_stage,week_number,madden_player_id,stat_category" })
    .select("id");

  if (upserted.error) throw new ApiError(500, "Failed to commit imported player weekly stats.", upserted.error);
  return { playerStatsAddedOrUpdated: upserted.data?.length ?? 0 };
}

async function upsertTeamWeeklyStats(importJobId: string, leagueId: string, teamMap: Map<string, string>) {
  const stagedStats = await loadStagedRows("rec_import_staging_team_stats", importJobId);
  if (stagedStats.length === 0) return { teamStatsAddedOrUpdated: 0 };

  const rows = (stagedStats as any[]).map((stat) => {
    const maddenTeamId = String(stat.team_external_id);
    return {
      league_id: leagueId,
      import_job_id: importJobId,
      season_number: stat.season_number ?? null,
      season_index: stat.season_index ?? null,
      season_stage: stat.season_stage ?? "regular_season",
      week_number: stat.week_number ?? null,
      team_id: teamMap.get(maddenTeamId) ?? null,
      madden_team_id: maddenTeamId,
      team_name: stat.team_name ?? null,
      stat_category: stat.stat_category ?? "team",
      stats: stat.stats ?? {},
      raw_payload: stat.raw_payload ?? {},
      updated_at: new Date().toISOString()
    };
  });

  const upserted = await supabase
    .from("rec_team_weekly_stats")
    .upsert(rows, { onConflict: "league_id,season_number,season_stage,week_number,madden_team_id,stat_category" })
    .select("id");

  if (upserted.error) throw new ApiError(500, "Failed to commit imported team weekly stats.", upserted.error);
  return { teamStatsAddedOrUpdated: upserted.data?.length ?? 0 };
}

export async function commitApprovedImport(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;

  if (!["validating", "completed_with_warnings", "reconciling"].includes(job.status)) {
    throw new ApiError(409, "Import must have a generated preview before commit.", {
      currentStatus: job.status
    });
  }

  const leagueId = job.league_id;
  const teamCommit = await upsertTeams(importJobId, leagueId);
  const committedTeamMap = await loadTeamMap(leagueId);
  const stagedTeamMap = await buildTeamMapFromStaging(importJobId, leagueId);
  const teamMap = new Map<string, string>([...committedTeamMap, ...stagedTeamMap, ...teamCommit.teamMap]);
  const assignmentMap = await loadAssignmentMap(leagueId);
  const gameCommit = await upsertGamesAndResults(importJobId, leagueId, teamMap, assignmentMap);
  const rosterCommit = await upsertPlayersAndRosterSnapshots(importJobId, leagueId, teamMap);
  const playerStatCommit = await upsertPlayerWeeklyStats(importJobId, leagueId, teamMap);
  const teamStatCommit = await upsertTeamWeeklyStats(importJobId, leagueId, teamMap);

  const stagedGameCountResult = await supabase
    .from("rec_import_staging_games")
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", importJobId);

  if (stagedGameCountResult.error) {
    throw new ApiError(500, "Failed to verify staged game count after commit.", stagedGameCountResult.error);
  }

  const committedGameCountResult = await supabase
    .from("rec_games")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (committedGameCountResult.error) {
    throw new ApiError(500, "Failed to verify committed game count after commit.", committedGameCountResult.error);
  }

  const stagedGameCount = stagedGameCountResult.count ?? 0;
  const committedGameCount = committedGameCountResult.count ?? 0;

  if (stagedGameCount > 0 && gameCommit.gamesAddedOrUpdated === 0) {
    throw new ApiError(500, "Schedule import approval failed: staged games were found but no games were written to rec_games.", {
      stagedGameCount,
      committedGameCount,
      gamesSkipped: gameCommit.gamesSkipped,
      skippedGames: gameCommit.skippedGames ?? []
    });
  }

  const previewSummary = {
    ...(job.preview_summary ?? {}),
    commitStatus: "completed",
    committedAt: new Date().toISOString(),
    committedCounts: {
      teams: teamCommit.addedOrUpdated,
      games: gameCommit.gamesAddedOrUpdated,
      gameResults: gameCommit.resultsAddedOrUpdated,
      gamesSkipped: gameCommit.gamesSkipped,
      committedLeagueGames: committedGameCount,
      stagedGames: stagedGameCount,
      players: rosterCommit.playersAddedOrUpdated,
      rosterSnapshots: rosterCommit.rosterSnapshotsAddedOrUpdated,
      playerWeeklyStats: playerStatCommit.playerStatsAddedOrUpdated,
      teamWeeklyStats: teamStatCommit.teamStatsAddedOrUpdated
    },
    gamesAdded: gameCommit.gamesAddedOrUpdated,
    gamesUpdated: 0,
    gamesSkipped: gameCommit.gamesSkipped,
    deferredSystems: {
      coinPayouts: "advance_engine_only",
      weeklyPayouts: "advance_engine_only",
      endOfSeasonPayouts: "advance_engine_only"
    },
    message: `Import committed. ${gameCommit.gamesAddedOrUpdated} game(s) were written to rec_games. Payouts remain deferred until league advance.`
  };

  return updateImportJobStatus({
    importJobId,
    status: gameCommit.gamesSkipped > 0 ? "completed_with_warnings" : "completed",
    previewSummary,
    validationWarnings: [
      ...((job.validation_warnings ?? []) as unknown[]),
      ...(gameCommit.gamesSkipped > 0
        ? [{ code: "commit_games_skipped", message: `${gameCommit.gamesSkipped} staged game(s) could not resolve both teams and were skipped.`, details: gameCommit.skippedGames ?? [] }]
        : [])
    ],
    validationErrors: job.validation_errors ?? []
  });
}
