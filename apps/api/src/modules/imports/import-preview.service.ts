import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getImportJob, updateImportJobStatus } from "./import.service.js";

type StagedGameRow = {
  week_number: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  game_status: string | null;
  external_game_id: string | null;
};

function formatMatchupResult(game: StagedGameRow) {
  const home = game.home_team_name ?? "Home Team";
  const away = game.away_team_name ?? "Away Team";
  const hasHomeScore = typeof game.home_score === "number";
  const hasAwayScore = typeof game.away_score === "number";
  const hasScore = hasHomeScore && hasAwayScore;

  if (!hasScore) {
    return {
      week: game.week_number,
      matchup: `${away} at ${home}`,
      result: "No final score imported",
      winner: null,
      loser: null,
      status: game.game_status ?? "staged",
      externalGameId: game.external_game_id,
      missingFields: [
        !hasHomeScore ? "home_score" : null,
        !hasAwayScore ? "away_score" : null
      ].filter(Boolean)
    };
  }

  const homeScore = game.home_score as number;
  const awayScore = game.away_score as number;
  const tied = homeScore === awayScore;
  const winner = tied ? null : homeScore > awayScore ? home : away;
  const loser = tied ? null : homeScore > awayScore ? away : home;

  return {
    week: game.week_number,
    matchup: `${away} at ${home}`,
    result: `${away} ${awayScore}, ${home} ${homeScore}`,
    winner,
    loser,
    status: tied ? "tie" : "final",
    externalGameId: game.external_game_id,
    missingFields: []
  };
}

async function buildImportedMatchupResults(importJobId: string) {
  const stagedGames = await supabase
    .from("rec_import_staging_games")
    .select("week_number, home_team_name, away_team_name, home_score, away_score, game_status, external_game_id")
    .eq("import_job_id", importJobId)
    .order("week_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (stagedGames.error) {
    throw new ApiError(500, "Failed to load staged matchup results.", stagedGames.error);
  }

  const games = (stagedGames.data ?? []) as StagedGameRow[];
  const results = games.map(formatMatchupResult);

  return {
    totalGamesImported: games.length,
    gamesWithFinalScores: results.filter((game) => game.winner || game.status === "tie").length,
    gamesMissingScores: results.filter((game) => game.result === "No final score imported").length,
    missingResultGames: results.filter((game) => game.result === "No final score imported"),
    results
  };
}

async function countRows(table: string, importJobId: string) {
  const result = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("import_job_id", importJobId);

  if (result.error) {
    throw new ApiError(500, `Failed to count ${table}.`, result.error);
  }

  return result.count ?? 0;
}

async function loadRows(table: string, importJobId: string, columns: string) {
  const result = await supabase
    .from(table)
    .select(columns)
    .eq("import_job_id", importJobId)
    .limit(25);

  if (result.error) {
    throw new ApiError(500, `Failed to inspect ${table}.`, result.error);
  }

  return result.data ?? [];
}

function missingFieldList(row: Record<string, unknown>, fields: string[]) {
  return fields.filter((field) => row[field] === null || row[field] === undefined || row[field] === "");
}

async function buildEndpointMissingData(importJobId: string) {
  const [games, standings, teamStats, playerStats] = await Promise.all([
    loadRows("rec_import_staging_games", importJobId, "week_number,external_game_id,home_team_name,away_team_name,home_score,away_score,game_status"),
    loadRows("rec_import_staging_standings", importJobId, "team_name,team_external_id,wins,losses,ties,points_for,points_against"),
    loadRows("rec_import_staging_team_stats", importJobId, "team_name,team_external_id,week_number,stats"),
    loadRows("rec_import_staging_player_stats", importJobId, "player_name,player_external_id,team_name,position,week_number,stats")
  ]);

  const gameMissing = games
    .map((row: any) => ({
      label: `${row.away_team_name ?? "Away"} at ${row.home_team_name ?? "Home"}${row.week_number ? `, Week ${row.week_number}` : ""}`,
      missingFields: missingFieldList(row, ["external_game_id", "home_team_name", "away_team_name", "home_score", "away_score", "game_status"])
    }))
    .filter((row) => row.missingFields.length > 0);

  const standingMissing = standings
    .map((row: any) => ({
      label: row.team_name ?? row.team_external_id ?? "Unknown Team",
      missingFields: missingFieldList(row, ["team_name", "team_external_id", "wins", "losses", "ties", "points_for", "points_against"])
    }))
    .filter((row) => row.missingFields.length > 0);

  const teamStatMissing = teamStats
    .map((row: any) => ({
      label: `${row.team_name ?? row.team_external_id ?? "Unknown Team"}${row.week_number ? `, Week ${row.week_number}` : ""}`,
      missingFields: [
        ...missingFieldList(row, ["team_name", "team_external_id", "stats"]),
        row.stats && Object.keys(row.stats).length === 0 ? "stats_payload_empty" : null
      ].filter(Boolean)
    }))
    .filter((row) => row.missingFields.length > 0);

  const playerStatMissing = playerStats
    .map((row: any) => ({
      label: `${row.player_name ?? row.player_external_id ?? "Unknown Player"}${row.team_name ? `, ${row.team_name}` : ""}${row.week_number ? `, Week ${row.week_number}` : ""}`,
      missingFields: [
        ...missingFieldList(row, ["player_name", "player_external_id", "team_name", "position", "stats"]),
        row.stats && Object.keys(row.stats).length === 0 ? "stats_payload_empty" : null
      ].filter(Boolean)
    }))
    .filter((row) => row.missingFields.length > 0);

  return [
    { endpointKey: "schedule", endpointLabel: "Schedule / Games", affectedRows: gameMissing.length, rows: gameMissing },
    { endpointKey: "standings", endpointLabel: "Standings", affectedRows: standingMissing.length, rows: standingMissing },
    { endpointKey: "team_stats", endpointLabel: "Team Stats", affectedRows: teamStatMissing.length, rows: teamStatMissing },
    { endpointKey: "player_stats", endpointLabel: "Player Stats", affectedRows: playerStatMissing.length, rows: playerStatMissing }
  ].filter((endpoint) => endpoint.affectedRows > 0);
}

async function buildEndpointRecordCounts(importJobId: string) {
  const [games, standings, teamStats, playerStats] = await Promise.all([
    countRows("rec_import_staging_games", importJobId),
    countRows("rec_import_staging_standings", importJobId),
    countRows("rec_import_staging_team_stats", importJobId),
    countRows("rec_import_staging_player_stats", importJobId)
  ]);

  return {
    games,
    standings,
    teamStats,
    playerStats
  };
}

function calculateImportConfidence(input: {
  recordCounts: Record<string, number>;
  gamesMissingScores: number;
  endpointMissingDataCount: number;
  warningCount: number;
}) {
  let score = 100;
  if (input.recordCounts.games === 0) score -= 25;
  score -= Math.min(input.gamesMissingScores * 5, 30);
  score -= Math.min(input.endpointMissingDataCount * 3, 25);
  score -= Math.min(input.warningCount * 2, 10);
  return Math.max(0, score);
}

export async function generateImportPreview(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;
  const matchupResults = await buildImportedMatchupResults(importJobId);
  const endpointRecordCounts = await buildEndpointRecordCounts(importJobId);
  const endpointMissingData = await buildEndpointMissingData(importJobId);
  const existingWarnings = job.validation_warnings ?? [];
  const generatedWarnings = matchupResults.totalGamesImported === 0
    ? [
        {
          code: "no_staged_games",
          message: "No staged games were found for this import job."
        }
      ]
    : [];
  const validationWarnings = [...existingWarnings, ...generatedWarnings];
  const importConfidence = calculateImportConfidence({
    recordCounts: endpointRecordCounts,
    gamesMissingScores: matchupResults.gamesMissingScores,
    endpointMissingDataCount: endpointMissingData.reduce((sum, endpoint) => sum + endpoint.affectedRows, 0),
    warningCount: validationWarnings.length
  });

  const previewSummary = {
    ...(job.preview_summary ?? {}),
    importJobId,
    previewStatus: "generated",
    importConfidence,
    endpointRecordCounts,
    endpointMissingData,
    matchupResults,
    gamesFound: matchupResults.totalGamesImported,
    gamesAdded: 0,
    gamesUpdated: 0,
    standingsChanges: 0,
    userRecordChanges: 0,
    headToHeadRecordChanges: 0,
    economyTransactions: 0,
    payouts: "Deferred until league advance. Imports do not issue payouts.",
    message: "Import preview generated. Matchup results reflect staged imported games and scores."
  };

  return updateImportJobStatus({
    importJobId,
    status: validationWarnings.length ? "completed_with_warnings" : "validating",
    previewSummary,
    validationWarnings,
    validationErrors: []
  });
}

export async function approveImportPreview(importJobId: string) {
  const details = await getImportJob(importJobId);

  if (!["validating", "completed_with_warnings"].includes(details.job.status)) {
    throw new ApiError(409, "Import must have a generated preview before approval.", {
      currentStatus: details.job.status
    });
  }

  return updateImportJobStatus({
    importJobId,
    status: "reconciling",
    previewSummary: {
      ...(details.job.preview_summary ?? {}),
      approvalStatus: "approved",
      economyTransactions: 0,
      payouts: "Deferred until league advance."
    },
    validationWarnings: details.job.validation_warnings ?? [],
    validationErrors: details.job.validation_errors ?? []
  });
}

export async function cancelImportJob(importJobId: string, reason?: string | null) {
  const result = await supabase
    .from("rec_import_jobs")
    .update({
      status: "cancelled",
      failure_reason: reason ?? "Cancelled by admin before commit."
    })
    .eq("id", importJobId)
    .select("*")
    .single();

  if (result.error) {
    throw new ApiError(500, "Failed to cancel import job.", result.error);
  }

  return getImportJob(importJobId);
}
