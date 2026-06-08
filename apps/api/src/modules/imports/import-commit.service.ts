import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getImportJob, updateImportJobStatus } from "./import.service.js";

type JsonObject = Record<string, unknown>;

type TeamRow = {
  id: string;
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

  const rows = stagedTeams.map((team: any) => ({
    league_id: leagueId,
    name: team.team_name ?? team.team_display_name ?? team.external_team_id ?? team.team_external_id ?? "Unknown Team",
    abbreviation: team.abbr_name ?? team.abbreviation ?? null,
    conference: team.conference ?? null,
    division: team.division_name ?? null,
    madden_team_id: toNullableText(team.team_external_id ?? team.external_team_id),
    source: "madden_companion_export",
    updated_at: new Date().toISOString()
  }));

  const upserted = await supabase
    .from("rec_teams")
    .upsert(rows, { onConflict: "league_id,madden_team_id" })
    .select("id,madden_team_id");

  if (upserted.error) throw new ApiError(500, "Failed to commit imported teams.", upserted.error);

  const teamMap = new Map<string, string>();
  for (const team of (upserted.data ?? []) as TeamRow[]) {
    if (team.madden_team_id) teamMap.set(String(team.madden_team_id), team.id);
  }

  return { addedOrUpdated: upserted.data?.length ?? 0, teamMap };
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
    const homeTeamId = game.home_team_external_id ? teamMap.get(String(game.home_team_external_id)) ?? null : null;
    const awayTeamId = game.away_team_external_id ? teamMap.get(String(game.away_team_external_id)) ?? null : null;

    if (!homeTeamId || !awayTeamId) {
      skipped.push(game.external_game_id);
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
      external_game_id: game.external_game_id,
      locked: false,
      updated_at: new Date().toISOString()
    });
  }

  const upsertedGames = gameRows.length
    ? await supabase
      .from("rec_games")
      .upsert(gameRows, { onConflict: "league_id,external_game_id" })
      .select("id,external_game_id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number,phase")
    : { data: [], error: null } as any;

  if (upsertedGames.error) throw new ApiError(500, "Failed to commit imported games.", upsertedGames.error);

  const gameByExternalId = new Map<string, CommittedGameRow>(
    ((upsertedGames.data ?? []) as CommittedGameRow[])
      .filter((game) => game.external_game_id)
      .map((game) => [String(game.external_game_id), game])
  );
  const resultRows = [];

  for (const staged of stagedGames as any[]) {
    if (!isFinalScore(staged.home_score, staged.away_score) || !staged.external_game_id) continue;
    const committed = gameByExternalId.get(String(staged.external_game_id));
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
      external_game_id: staged.external_game_id,
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
      point_differential: Math.abs(homeScore - awayScore),
      played_at: staged.played_at ?? null,
      source: "madden_companion_export",
      raw_payload: staged.raw_payload ?? {},
      updated_at: new Date().toISOString()
    });
  }

  const upsertedResults = resultRows.length
    ? await supabase
      .from("rec_game_results")
      .upsert(resultRows, { onConflict: "league_id,external_game_id" })
      .select("id")
    : { data: [], error: null } as any;

  if (upsertedResults.error) throw new ApiError(500, "Failed to commit imported game results.", upsertedResults.error);

  return {
    gamesAddedOrUpdated: upsertedGames.data?.length ?? 0,
    resultsAddedOrUpdated: upsertedResults.data?.length ?? 0,
    gamesSkipped: skipped.length
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
  const teamMap = teamCommit.teamMap.size ? teamCommit.teamMap : await loadTeamMap(leagueId);
  const assignmentMap = await loadAssignmentMap(leagueId);
  const gameCommit = await upsertGamesAndResults(importJobId, leagueId, teamMap, assignmentMap);
  const rosterCommit = await upsertPlayersAndRosterSnapshots(importJobId, leagueId, teamMap);
  const playerStatCommit = await upsertPlayerWeeklyStats(importJobId, leagueId, teamMap);
  const teamStatCommit = await upsertTeamWeeklyStats(importJobId, leagueId, teamMap);

  const previewSummary = {
    ...(job.preview_summary ?? {}),
    commitStatus: "completed",
    committedAt: new Date().toISOString(),
    committedCounts: {
      teams: teamCommit.addedOrUpdated,
      games: gameCommit.gamesAddedOrUpdated,
      gameResults: gameCommit.resultsAddedOrUpdated,
      gamesSkipped: gameCommit.gamesSkipped,
      players: rosterCommit.playersAddedOrUpdated,
      rosterSnapshots: rosterCommit.rosterSnapshotsAddedOrUpdated,
      playerWeeklyStats: playerStatCommit.playerStatsAddedOrUpdated,
      teamWeeklyStats: teamStatCommit.teamStatsAddedOrUpdated
    },
    deferredSystems: {
      coinPayouts: "advance_engine_only",
      weeklyPayouts: "advance_engine_only",
      endOfSeasonPayouts: "advance_engine_only"
    },
    message: "Import committed. Payouts remain deferred until league advance."
  };

  return updateImportJobStatus({
    importJobId,
    status: gameCommit.gamesSkipped > 0 ? "completed_with_warnings" : "completed",
    previewSummary,
    validationWarnings: [
      ...((job.validation_warnings ?? []) as unknown[]),
      ...(gameCommit.gamesSkipped > 0
        ? [{ code: "commit_games_skipped", message: `${gameCommit.gamesSkipped} staged game(s) could not resolve both teams and were skipped.` }]
        : [])
    ],
    validationErrors: job.validation_errors ?? []
  });
}
