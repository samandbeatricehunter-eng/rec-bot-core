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
  const hasScore = typeof game.home_score === "number" && typeof game.away_score === "number";

  if (!hasScore) {
    return {
      week: game.week_number,
      matchup: `${away} at ${home}`,
      result: "No final score imported",
      winner: null,
      loser: null,
      status: game.game_status ?? "staged",
      externalGameId: game.external_game_id
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
    externalGameId: game.external_game_id
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
    results
  };
}

export async function generateImportPreview(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;
  const matchupResults = await buildImportedMatchupResults(importJobId);

  const previewSummary = {
    ...(job.preview_summary ?? {}),
    importJobId,
    previewStatus: "generated",
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
    status: "validating",
    previewSummary,
    validationWarnings: matchupResults.totalGamesImported === 0
      ? [
          {
            code: "no_staged_games",
            message: "No staged games were found for this import job."
          }
        ]
      : [],
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
