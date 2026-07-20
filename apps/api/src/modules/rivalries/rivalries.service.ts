// @ts-nocheck
import { randomUUID } from "node:crypto";
import { CFB_27_RIVALRIES } from "@rec/shared";
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

async function ensureCatalog() {
  const rows = CFB_27_RIVALRIES.map((row) => ({
    id: randomUUID(), team_a_abbreviation: row.teamAAbbreviation, team_b_abbreviation: row.teamBAbbreviation,
    rivalry_name: row.rivalryName, first_year_played: row.firstYearPlayed, team_a_wins: row.teamAWins,
    team_b_wins: row.teamBWins, ties: row.ties, last_game_team_a_score: row.lastGameTeamAScore,
    last_game_team_b_score: row.lastGameTeamBScore, streak_winner_abbreviation: row.streakWinnerAbbreviation,
    streak_length: row.streakLength, verified_through_year: row.verifiedThroughYear, source_url: row.sourceUrl,
  }));
  const result = await supabase.from("rec_cfb_rivalry_catalog").upsert(rows, { onConflict: "team_a_abbreviation,team_b_abbreviation", ignoreDuplicates: true });
  if (result.error) throw new ApiError(500, "Failed to seed the CFB rivalry catalog.", result.error);
}

export async function ensureLeagueRivalries(leagueId: string, game: string | null | undefined) {
  if (game !== "cfb_27") return;
  await ensureCatalog();
  const [teams, catalog] = await Promise.all([
    supabase.from("rec_teams").select("id,abbreviation,is_relocated").eq("league_id", leagueId),
    supabase.from("rec_cfb_rivalry_catalog").select("*"),
  ]);
  if (teams.error || catalog.error) throw new ApiError(500, "Failed to load rivalry seed data.", teams.error ?? catalog.error);
  const byAbbr = new Map((teams.data ?? []).filter((team: any) => !team.is_relocated).map((team: any) => [String(team.abbreviation).toUpperCase(), team]));
  const rows = (catalog.data ?? []).flatMap((item: any) => {
    const a: any = byAbbr.get(String(item.team_a_abbreviation).toUpperCase());
    const b: any = byAbbr.get(String(item.team_b_abbreviation).toUpperCase());
    if (!a || !b) return [];
    const streakWinnerTeamId = item.streak_winner_abbreviation === item.team_a_abbreviation ? a.id : item.streak_winner_abbreviation === item.team_b_abbreviation ? b.id : null;
    return [{
      id: randomUUID(), league_id: leagueId, catalog_id: item.id, team_a_id: a.id, team_b_id: b.id,
      rivalry_name: item.rivalry_name, first_year_played: item.first_year_played,
      baseline_team_a_wins: item.team_a_wins, baseline_team_b_wins: item.team_b_wins, baseline_ties: item.ties,
      baseline_last_game_team_a_score: item.last_game_team_a_score, baseline_last_game_team_b_score: item.last_game_team_b_score,
      baseline_streak_winner_team_id: streakWinnerTeamId, baseline_streak_length: item.streak_length,
      team_a_wins: item.team_a_wins, team_b_wins: item.team_b_wins, ties: item.ties,
      last_game_team_a_score: item.last_game_team_a_score, last_game_team_b_score: item.last_game_team_b_score,
      streak_winner_team_id: streakWinnerTeamId, streak_length: item.streak_length, is_seeded: true, is_active: true,
    }];
  });
  if (!rows.length) return;
  const seeded = await supabase.from("rec_league_rivalries").upsert(rows, { onConflict: "league_id,team_a_id,team_b_id", ignoreDuplicates: true });
  if (seeded.error) throw new ApiError(500, "Failed to seed league rivalries.", seeded.error);
}

export async function clearRivalriesForCustomTeam(leagueId: string, teamId: string) {
  const result = await supabase.from("rec_league_rivalries").delete().eq("league_id", leagueId).or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);
  if (result.error) throw new ApiError(500, "Failed to clear inherited rivalries for the custom team.", result.error);
}

export async function assignKnownRivalryToGame(gameId: string) {
  const game = await supabase.from("rec_games").select("id,league_id,home_team_id,away_team_id,rivalry_id,rivalry_opt_out").eq("id", gameId).single();
  if (game.error || !game.data || game.data.rivalry_id || game.data.rivalry_opt_out) return game.data?.rivalry_id ?? null;
  const rivalry = await supabase.from("rec_league_rivalries").select("id").eq("league_id", game.data.league_id).eq("is_active", true)
    .or(`and(team_a_id.eq.${game.data.home_team_id},team_b_id.eq.${game.data.away_team_id}),and(team_a_id.eq.${game.data.away_team_id},team_b_id.eq.${game.data.home_team_id})`).limit(1).maybeSingle();
  if (rivalry.error) throw new ApiError(500, "Failed to match the scheduled rivalry.", rivalry.error);
  if (!rivalry.data) return null;
  const updated = await supabase.from("rec_games").update({ rivalry_id: rivalry.data.id }).eq("id", gameId);
  if (updated.error) throw new ApiError(500, "Failed to mark the rivalry game.", updated.error);
  return rivalry.data.id;
}

export async function setGameRivalry(input: { leagueId: string; gameId: string; enabled: boolean; details?: RivalryDetailsInput }) {
  const game = await supabase.from("rec_games").select("id,league_id,home_team_id,away_team_id").eq("id", input.gameId).eq("league_id", input.leagueId).single();
  if (game.error || !game.data) throw new ApiError(404, "Scheduled game was not found.", game.error);
  if (!input.enabled) {
    const cleared = await supabase.from("rec_games").update({ rivalry_id: null, rivalry_opt_out: true }).eq("id", input.gameId);
    if (cleared.error) throw new ApiError(500, "Failed to turn off the rivalry game.", cleared.error);
    return { enabled: false, rivalry: null };
  }
  let rivalry = await supabase.from("rec_league_rivalries").select("*").eq("league_id", input.leagueId)
    .or(`and(team_a_id.eq.${game.data.home_team_id},team_b_id.eq.${game.data.away_team_id}),and(team_a_id.eq.${game.data.away_team_id},team_b_id.eq.${game.data.home_team_id})`).limit(1).maybeSingle();
  if (rivalry.error) throw new ApiError(500, "Failed to load rivalry details.", rivalry.error);
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
