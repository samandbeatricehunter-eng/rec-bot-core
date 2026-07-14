import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getBoxScoreUploadEligibility } from "../box-score/box-score.service.js";

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

// Fallback position guess used only when creating a brand-new watched-player row from the
// Discord Player Stats flow, which never asks for position — rec_watched_players.position
// is NOT NULL, and a category-derived guess is better than blocking submission on it.
// The guess is never applied to an already-known player (their real position wins).
const CATEGORY_POSITION_GUESS: Record<string, string> = {
  passing: "QB", rushing: "HB", receiving: "WR", defensive: "DEF", kick_return: "KR",
};

// Self-serve entry point for the Discord "Player Stats" button — resolves (or creates) the
// named watched player on the submitter's own team, then logs one performance-tag stat
// line for their currently-scheduled game this week. Gated on the coach already having a
// box score submission for that game (pending is enough — see getBoxScoreUploadEligibility),
// same as the box-score channel's own H2H-duplicate check.
export async function submitPlayerStatLine(input: {
  guildId: string;
  discordId: string;
  playerName: string;
  category: string;
  statLines: Array<{ statKey: string; label: string; value: number }>;
}): Promise<{ playerId: string; tagId: string; submissionId: string; teamId: string; gameId: string }> {
  const eligibility = await getBoxScoreUploadEligibility({ guildId: input.guildId, discordId: input.discordId });
  if (!eligibility.teamId) throw new ApiError(400, "You aren't linked to a team in this league.");
  if (!eligibility.gameId) throw new ApiError(400, `You don't have a scheduled game in Week ${eligibility.weekNumber}.`);
  if (!eligibility.existingSubmission) throw new ApiError(400, "Submit your box score for this game before adding player stats.");

  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();
  const trimmedName = input.playerName.trim();
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();

  const teamPlayers = await supabase
    .from("rec_watched_players")
    .select("id,player_name")
    .eq("team_id", eligibility.teamId)
    .eq("is_active", true);
  if (teamPlayers.error) throw new ApiError(500, "Failed to check the players-to-watch list.", teamPlayers.error);
  const existingPlayer = (teamPlayers.data ?? []).find((row: any) => String(row.player_name).trim().toLowerCase() === trimmedName.toLowerCase());

  let playerId: string | null = existingPlayer?.id ?? null;
  if (!playerId) {
    const created = await supabase
      .from("rec_watched_players")
      .insert({
        id: randomUUID(), league_id: context.leagueId, team_id: eligibility.teamId,
        player_name: trimmedName, position: CATEGORY_POSITION_GUESS[input.category] ?? "ATH", class_year: null,
        is_active: true, created_at: now, updated_at: now,
      })
      .select("id")
      .single();
    if (created.error) throw new ApiError(500, "Failed to add the player to the watch list.", created.error);
    playerId = created.data.id;
  }

  const tagId = randomUUID();
  const inserted = await supabase.from("rec_game_performance_tags").insert({
    id: tagId, league_id: context.leagueId, game_id: eligibility.gameId,
    season_number: eligibility.seasonNumber, week_number: eligibility.weekNumber,
    team_id: eligibility.teamId, subject_type: "player", watched_player_id: playerId, unit: null,
    stat_lines: input.statLines, performance_grade: "solid", created_at: now, updated_at: now,
  });
  if (inserted.error) throw new ApiError(500, "Failed to save the player stat line.", inserted.error);

  const normalizedName = trimmedName.toLowerCase().replace(/\s+/g, " ");
  const existingSubmission = await supabase.from("rec_player_stat_submissions").select("id").eq("game_id", eligibility.gameId).eq("team_id", eligibility.teamId).eq("submitted_by_discord_id", input.discordId).eq("normalized_player_name", normalizedName).maybeSingle();
  if (existingSubmission.error) throw new ApiError(500, "Failed to load the player submission.", existingSubmission.error);
  const submissionId = existingSubmission.data?.id ?? randomUUID();
  if (!existingSubmission.data) {
    const submission = await supabase.from("rec_player_stat_submissions").insert({
      id: submissionId, league_id: context.leagueId, season_number: eligibility.seasonNumber,
      season_stage: context.rec_leagues.season_stage, week_number: eligibility.weekNumber,
      game_id: eligibility.gameId, team_id: eligibility.teamId, submitted_by_user_id: account.data?.user_id ?? null,
      submitted_by_discord_id: input.discordId, watched_player_id: playerId,
      player_display_name: trimmedName, normalized_player_name: normalizedName, status: "submitted",
      created_at: now, updated_at: now,
    });
    if (submission.error) throw new ApiError(500, "Failed to save the player submission.", submission.error);
  }
  const stats = Object.fromEntries(input.statLines.map((line) => [line.statKey, line.value]));
  const rawValues = Object.fromEntries(input.statLines.map((line) => [line.statKey, String(line.value)]));
  const line = await supabase.from("rec_player_stat_lines").upsert({ id: randomUUID(), submission_id: submissionId, category: input.category, stats, raw_values: rawValues, updated_at: now }, { onConflict: "submission_id,category" });
  if (line.error) throw new ApiError(500, "Failed to save the stat category.", line.error);
  await supabase.from("rec_player_stat_audit").insert({ submission_id: submissionId, action: "stat_line_submitted", actor_discord_id: input.discordId, new_value: { category: input.category, stats } });

  return { playerId: playerId!, tagId, submissionId, teamId: eligibility.teamId, gameId: eligibility.gameId };
}

export async function listMyWatchedPlayers(guildId: string, discordId: string): Promise<{ players: WatchedPlayer[] }> {
  const eligibility = await getBoxScoreUploadEligibility({ guildId, discordId });
  if (!eligibility.teamId) throw new ApiError(400, "You aren't linked to a team in this league.");
  return listWatchedPlayers(guildId, eligibility.teamId);
}
export async function removeMyPlayerStatLine(input:{guildId:string;discordId:string;playerName:string;category:string}){
  const eligibility=await getBoxScoreUploadEligibility({guildId:input.guildId,discordId:input.discordId}); if(!eligibility.gameId||!eligibility.teamId)throw new ApiError(400,"No current game was found.");
  const normalized=input.playerName.trim().toLowerCase().replace(/\s+/g," "); const submission=await supabase.from("rec_player_stat_submissions").select("id,watched_player_id").eq("game_id",eligibility.gameId).eq("team_id",eligibility.teamId).eq("submitted_by_discord_id",input.discordId).eq("normalized_player_name",normalized).maybeSingle(); if(submission.error||!submission.data)throw new ApiError(404,"Stat submission not found.",submission.error);
  const removed=await supabase.from("rec_player_stat_lines").delete().eq("submission_id",submission.data.id).eq("category",input.category); if(removed.error)throw new ApiError(500,"Failed to remove stat line.",removed.error);
  const tags=await supabase.from("rec_game_performance_tags").select("id,stat_lines").eq("game_id",eligibility.gameId).eq("team_id",eligibility.teamId).eq("watched_player_id",submission.data.watched_player_id).order("created_at",{ascending:false}).limit(1); const matching=tags.data?.[0];
  if(matching)await supabase.from("rec_game_performance_tags").delete().eq("id",matching.id);
  await supabase.from("rec_player_stat_audit").insert({submission_id:submission.data.id,action:"stat_line_removed",actor_discord_id:input.discordId,previous_value:{category:input.category}}); return{removed:true};
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

export async function listPlayerStatSubmissions(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const submissions = await supabase.from("rec_player_stat_submissions").select("id,season_number,season_stage,week_number,team_id,game_id,submitted_by_discord_id,player_display_name,status,reviewed_by_discord_id,reviewed_at,created_at").eq("league_id", context.leagueId).neq("status", "removed").order("created_at", { ascending: false });
  if (submissions.error) throw new ApiError(500, "Failed to load player-stat submissions.", submissions.error);
  const ids = (submissions.data ?? []).map((row) => row.id); const teamIds = [...new Set((submissions.data ?? []).map((row) => row.team_id))];
  const [lines, teams] = await Promise.all([
    ids.length ? supabase.from("rec_player_stat_lines").select("id,submission_id,category,stats,updated_at").in("submission_id", ids) : Promise.resolve({ data: [], error: null }),
    teamIds.length ? supabase.from("rec_teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (lines.error || teams.error) throw new ApiError(500, "Failed to load player-stat details.", lines.error ?? teams.error);
  const teamNames = new Map((teams.data ?? []).map((team) => [team.id, team.name]));
  return { submissions: (submissions.data ?? []).map((row) => ({ id: row.id, seasonNumber: row.season_number, seasonStage: row.season_stage, weekNumber: row.week_number, teamId: row.team_id, teamName: teamNames.get(row.team_id) ?? "Unknown team", gameId: row.game_id, submittedByDiscordId: row.submitted_by_discord_id, playerName: row.player_display_name, status: row.status, reviewedByDiscordId: row.reviewed_by_discord_id, reviewedAt: row.reviewed_at, createdAt: row.created_at, lines: (lines.data ?? []).filter((line) => line.submission_id === row.id).map((line) => ({ id: line.id, category: line.category, stats: line.stats, updatedAt: line.updated_at })) })) };
}

async function assertSubmission(guildId: string, id: string) {
  const context = await getCurrentLeagueContext(guildId); const result = await supabase.from("rec_player_stat_submissions").select("id,league_id,player_display_name,status").eq("id", id).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load player-stat submission.", result.error);
  if (!result.data || result.data.league_id !== context.leagueId) throw new ApiError(404, "Player-stat submission not found."); return result.data;
}

export async function updatePlayerStatSubmission(input: { guildId: string; id: string; actorDiscordId: string; playerName?: string; status?: "submitted"|"approved"|"rejected"; lines?: Array<{ category: string; stats: Record<string, number> }> }) {
  const existing = await assertSubmission(input.guildId, input.id); const now = new Date().toISOString(); const patch: Record<string, unknown> = { updated_at: now };
  if (input.playerName) { patch.player_display_name = input.playerName.trim(); patch.normalized_player_name = input.playerName.trim().toLowerCase().replace(/\s+/g," "); }
  if (input.status) { patch.status = input.status; patch.reviewed_by_discord_id = input.actorDiscordId; patch.reviewed_at = now; }
  const updated = await supabase.from("rec_player_stat_submissions").update(patch).eq("id", input.id); if (updated.error) throw new ApiError(500,"Failed to update player-stat submission.",updated.error);
  if (input.lines) for (const line of input.lines) { const saved = await supabase.from("rec_player_stat_lines").upsert({ submission_id: input.id, category: line.category, stats: line.stats, raw_values: Object.fromEntries(Object.entries(line.stats).map(([key,value])=>[key,String(value)])), updated_at: now }, { onConflict: "submission_id,category" }); if(saved.error) throw new ApiError(500,"Failed to update stat line.",saved.error); }
  await supabase.from("rec_player_stat_audit").insert({ submission_id: input.id, action: "commissioner_updated", actor_discord_id: input.actorDiscordId, previous_value: existing, new_value: input });
  return { updated: true };
}

export async function removePlayerStatSubmission(input: { guildId: string; id: string; actorDiscordId: string }) {
  const existing = await assertSubmission(input.guildId,input.id); const now=new Date().toISOString(); const result=await supabase.from("rec_player_stat_submissions").update({status:"removed",reviewed_by_discord_id:input.actorDiscordId,reviewed_at:now,updated_at:now}).eq("id",input.id); if(result.error) throw new ApiError(500,"Failed to remove player-stat submission.",result.error);
  await supabase.from("rec_player_stat_audit").insert({submission_id:input.id,action:"commissioner_removed",actor_discord_id:input.actorDiscordId,previous_value:existing}); return {removed:true};
}
