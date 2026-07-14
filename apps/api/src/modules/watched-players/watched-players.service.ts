import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export const CLASS_YEARS = ["freshman", "sophomore", "junior", "senior"] as const;
export type ClassYear = (typeof CLASS_YEARS)[number];

export type WatchedPlayer = {
  id: string;
  teamId: string;
  playerName: string;
  position: string;
  classYear: ClassYear | null;
};

function mapRow(row: any): WatchedPlayer {
  return { id: row.id, teamId: row.team_id, playerName: row.player_name, position: row.position, classYear: row.class_year ?? null };
}

async function assertTeamInLeague(leagueId: string, teamId: string) {
  const team = await supabase.from("rec_teams").select("id").eq("id", teamId).eq("league_id", leagueId).maybeSingle();
  if (team.error) throw new ApiError(500, "Failed to verify team.", team.error);
  if (!team.data) throw new ApiError(404, "Team not found in this league.");
}

export async function listWatchedPlayers(guildId: string, teamId: string): Promise<{ players: WatchedPlayer[] }> {
  const context = await getCurrentLeagueContext(guildId);
  await assertTeamInLeague(context.leagueId, teamId);
  const result = await supabase
    .from("rec_watched_players")
    .select("id,team_id,player_name,position,class_year")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .order("player_name", { ascending: true });
  if (result.error) throw new ApiError(500, "Failed to load the players-to-watch list.", result.error);
  return { players: (result.data ?? []).map(mapRow) };
}

export async function createWatchedPlayer(input: { guildId: string; teamId: string; playerName: string; position: string; classYear?: ClassYear | null }): Promise<{ player: WatchedPlayer }> {
  const context = await getCurrentLeagueContext(input.guildId);
  await assertTeamInLeague(context.leagueId, input.teamId);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), league_id: context.leagueId, team_id: input.teamId,
    player_name: input.playerName.trim(), position: input.position.trim(), class_year: input.classYear ?? null,
    is_active: true, created_at: now, updated_at: now,
  };
  const result = await supabase.from("rec_watched_players").insert(row).select("id,team_id,player_name,position,class_year").single();
  if (result.error) throw new ApiError(500, "Failed to add the player to the watch list.", result.error);
  return { player: mapRow(result.data) };
}

export async function updateWatchedPlayer(input: { guildId: string; id: string; playerName: string; position: string; classYear?: ClassYear | null }): Promise<{ player: WatchedPlayer }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_watched_players").select("id,league_id").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the watched player.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Watched player not found.");
  const result = await supabase
    .from("rec_watched_players")
    .update({ player_name: input.playerName.trim(), position: input.position.trim(), class_year: input.classYear ?? null, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .select("id,team_id,player_name,position,class_year")
    .single();
  if (result.error) throw new ApiError(500, "Failed to update the watched player.", result.error);
  return { player: mapRow(result.data) };
}

// Soft delete (is_active = false) rather than a hard delete — historical performance tags
// from past games may still reference this player and need to keep resolving.
export async function removeWatchedPlayer(input: { guildId: string; id: string }): Promise<{ removed: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_watched_players").select("id,league_id").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the watched player.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Watched player not found.");
  const result = await supabase.from("rec_watched_players").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", input.id);
  if (result.error) throw new ApiError(500, "Failed to remove the watched player.", result.error);
  return { removed: true };
}
