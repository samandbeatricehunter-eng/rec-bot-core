import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getImportJob } from "./import.service.js";

export type ManualScoreInput = {
  stagingGameId: string;
  homeScore: number;
  awayScore: number;
  resolvedByDiscordId: string;
  notes?: string | null;
};

export type MissingScoreActionInput = {
  stagingGameId: string;
  requestedByDiscordId: string;
  notes?: string | null;
};

function isMissingScore(game: { home_score: number | null; away_score: number | null }) {
  return typeof game.home_score !== "number" || typeof game.away_score !== "number";
}

export async function listMissingImportedGameScores(importJobId: string) {
  await getImportJob(importJobId);

  const result = await supabase
    .from("rec_import_staging_games")
    .select("*")
    .eq("import_job_id", importJobId)
    .order("week_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (result.error) {
    throw new ApiError(500, "Failed to load imported games for score resolution.", result.error);
  }

  const games = result.data ?? [];
  const missing = games.filter((game) => isMissingScore(game));

  return {
    importJobId,
    totalGames: games.length,
    missingCount: missing.length,
    resolvedOrCompleteCount: games.length - missing.length,
    missing
  };
}

export async function requestMissingGameScoreReimport(input: MissingScoreActionInput) {
  const existing = await supabase
    .from("rec_import_staging_games")
    .select("id, import_job_id, home_score, away_score")
    .eq("id", input.stagingGameId)
    .single();

  if (existing.error) {
    throw new ApiError(404, "Imported game was not found.", existing.error);
  }

  if (!isMissingScore(existing.data)) {
    throw new ApiError(409, "This imported game already has a score and does not require reimport.");
  }

  const updated = await supabase
    .from("rec_import_staging_games")
    .update({
      score_fix_status: "reimport_requested",
      score_fix_source: "ea_reimport",
      score_reimport_requested_at: new Date().toISOString(),
      score_reimport_requested_by_discord_id: input.requestedByDiscordId,
      score_fix_notes: input.notes ?? null
    })
    .eq("id", input.stagingGameId)
    .select("*")
    .single();

  if (updated.error) {
    throw new ApiError(500, "Failed to mark imported game for score reimport.", updated.error);
  }

  return {
    game: updated.data,
    message: "Score reimport requested. The next reimport action should target this staged game only."
  };
}

export async function manuallyResolveImportedGameScore(input: ManualScoreInput) {
  const existing = await supabase
    .from("rec_import_staging_games")
    .select("id, import_job_id, home_score, away_score")
    .eq("id", input.stagingGameId)
    .single();

  if (existing.error) {
    throw new ApiError(404, "Imported game was not found.", existing.error);
  }

  const updated = await supabase
    .from("rec_import_staging_games")
    .update({
      home_score: input.homeScore,
      away_score: input.awayScore,
      game_status: "final",
      score_fix_status: "resolved",
      score_fix_source: "manual_admin_entry",
      score_fixed_by_discord_id: input.resolvedByDiscordId,
      score_fixed_at: new Date().toISOString(),
      score_fix_notes: input.notes ?? null
    })
    .eq("id", input.stagingGameId)
    .select("*")
    .single();

  if (updated.error) {
    throw new ApiError(500, "Failed to manually resolve imported game score.", updated.error);
  }

  return {
    game: updated.data,
    message: "Imported game score was manually resolved. Regenerate the import preview before approval."
  };
}

export async function ignoreMissingImportedGameScore(input: MissingScoreActionInput) {
  const existing = await supabase
    .from("rec_import_staging_games")
    .select("id, import_job_id, home_score, away_score")
    .eq("id", input.stagingGameId)
    .single();

  if (existing.error) {
    throw new ApiError(404, "Imported game was not found.", existing.error);
  }

  if (!isMissingScore(existing.data)) {
    throw new ApiError(409, "This imported game already has a score and does not need to be ignored.");
  }

  const updated = await supabase
    .from("rec_import_staging_games")
    .update({
      score_fix_status: "ignored",
      score_fix_source: "ignored",
      score_fixed_by_discord_id: input.requestedByDiscordId,
      score_fixed_at: new Date().toISOString(),
      score_fix_notes: input.notes ?? null
    })
    .eq("id", input.stagingGameId)
    .select("*")
    .single();

  if (updated.error) {
    throw new ApiError(500, "Failed to ignore missing imported game score.", updated.error);
  }

  return {
    game: updated.data,
    message: "Missing imported game score was ignored. This game will not block import review."
  };
}
