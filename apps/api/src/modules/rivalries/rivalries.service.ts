import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type RivalryDetailsInput = {
  rivalryName: string;
  firstYearPlayed: number | null;
  teamAWins: number;
  teamBWins: number;
  ties?: number;
  lastGameTeamAScore: number | null;
  lastGameTeamBScore: number | null;
  streakWinnerTeamId: string | null;
  streakLength: number;
};

export async function clearRivalriesForCustomTeam(leagueId: string, teamId: string) {
  const result = await supabase.from("rec_league_rivalries").delete().eq("league_id", leagueId).or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);
  if (result.error) throw new ApiError(500, "Failed to clear inherited rivalries for the custom team.", result.error);
}

export async function assignKnownRivalryToGame(gameId: string) {
  const game = await supabase.from("rec_games").select("id,league_id,home_team_id,away_team_id,rivalry_id,rivalry_opt_out").eq("id", gameId).single();
  if (game.error || !game.data || game.data.rivalry_id || game.data.rivalry_opt_out) return game.data?.rivalry_id ?? null;
  const rivalries = await supabase.from("rec_league_rivalries").select("id,team_a_id,team_b_id")
    .eq("league_id", game.data.league_id).eq("is_active", true)
    .in("team_a_id", [game.data.home_team_id, game.data.away_team_id])
    .in("team_b_id", [game.data.home_team_id, game.data.away_team_id]);
  if (rivalries.error) throw new ApiError(500, "Failed to match the scheduled rivalry.", rivalries.error);
  const rivalry = (rivalries.data ?? []).find((row: any) =>
    (row.team_a_id === game.data.home_team_id && row.team_b_id === game.data.away_team_id)
    || (row.team_a_id === game.data.away_team_id && row.team_b_id === game.data.home_team_id));
  if (!rivalry) return null;
  const updated = await supabase.from("rec_games").update({ rivalry_id: rivalry.id }).eq("id", gameId);
  if (updated.error) throw new ApiError(500, "Failed to mark the rivalry game.", updated.error);
  return rivalry.id;
}

export async function setGameRivalry(input: { leagueId: string; gameId: string; enabled: boolean; details?: RivalryDetailsInput }) {
  const game = await supabase.from("rec_games").select("id,league_id,home_team_id,away_team_id").eq("id", input.gameId).eq("league_id", input.leagueId).single();
  if (game.error || !game.data) throw new ApiError(404, "Scheduled game was not found.", game.error);
  if (!input.enabled) {
    const cleared = await supabase.from("rec_games").update({ rivalry_id: null, rivalry_opt_out: true }).eq("id", input.gameId);
    if (cleared.error) throw new ApiError(500, "Failed to turn off the rivalry game.", cleared.error);
    return { enabled: false, rivalry: null };
  }
  const rivalryRows = await supabase.from("rec_league_rivalries").select("*").eq("league_id", input.leagueId)
    .in("team_a_id", [game.data.home_team_id, game.data.away_team_id])
    .in("team_b_id", [game.data.home_team_id, game.data.away_team_id]);
  if (rivalryRows.error) throw new ApiError(500, "Failed to load rivalry details.", rivalryRows.error);
  let rivalry: any = {
    data: (rivalryRows.data ?? []).find((row: any) =>
      (row.team_a_id === game.data.home_team_id && row.team_b_id === game.data.away_team_id)
      || (row.team_a_id === game.data.away_team_id && row.team_b_id === game.data.home_team_id)) ?? null,
    error: null,
  };
  if (!rivalry.data && !input.details) throw new ApiError(400, "Rivalry details are required for a new rivalry.");
  if (!rivalry.data) {
    const d = input.details!;
    const inserted = await supabase.from("rec_league_rivalries").insert({
      id: randomUUID(), league_id: input.leagueId, team_a_id: game.data.home_team_id, team_b_id: game.data.away_team_id,
      rivalry_name: d.rivalryName.trim(), first_year_played: d.firstYearPlayed,
      baseline_team_a_wins: d.teamAWins, baseline_team_b_wins: d.teamBWins, baseline_ties: d.ties ?? 0,
      baseline_last_game_team_a_score: d.lastGameTeamAScore, baseline_last_game_team_b_score: d.lastGameTeamBScore,
      baseline_streak_winner_team_id: d.streakWinnerTeamId, baseline_streak_length: d.streakLength,
      team_a_wins: d.teamAWins, team_b_wins: d.teamBWins, ties: d.ties ?? 0,
      last_game_team_a_score: d.lastGameTeamAScore, last_game_team_b_score: d.lastGameTeamBScore,
      streak_winner_team_id: d.streakWinnerTeamId, streak_length: d.streakLength, is_seeded: false, is_active: true,
    }).select("*").single();
    if (inserted.error) throw new ApiError(500, "Failed to create rivalry.", inserted.error);
    rivalry = inserted;
  } else if (input.details) {
    const d = input.details;
    const updated = await supabase.from("rec_league_rivalries").update({ rivalry_name: d.rivalryName.trim(), first_year_played: d.firstYearPlayed }).eq("id", rivalry.data.id).select("*").single();
    if (updated.error) throw new ApiError(500, "Failed to update rivalry.", updated.error);
    rivalry = updated;
  }
  const marked = await supabase.from("rec_games").update({ rivalry_id: rivalry.data.id, rivalry_opt_out: false }).eq("id", input.gameId);
  if (marked.error) throw new ApiError(500, "Failed to mark the rivalry game.", marked.error);
  return { enabled: true, rivalry: rivalry.data };
}

export async function loadGameRivalries(gameIds: string[]) {
  if (!gameIds.length) return new Map();
  const result = await supabase.from("rec_games").select("id,rivalry_id,rivalry_opt_out,rivalry:rec_league_rivalries(*)").in("id", gameIds);
  if (result.error) throw new ApiError(500, "Failed to load scheduled rivalries.", result.error);
  return new Map((result.data ?? []).map((row: any) => [row.id, { enabled: Boolean(row.rivalry_id), optedOut: Boolean(row.rivalry_opt_out), details: row.rivalry ?? null }]));
}
