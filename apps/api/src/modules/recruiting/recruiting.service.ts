import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

export type RecruitStatus = "uncommitted" | "committed" | "decommitted";
export type Recruit = {
  id: string; playerName: string; position: string; homeCity: string | null; homeState: string | null;
  starRating: number; status: RecruitStatus; committedTeamId: string | null; committedTeamExternal: string | null;
  commitDate: string | null; storyId: string | null;
};

function mapRow(row: any): Recruit {
  return {
    id: row.id, playerName: row.player_name, position: row.position, homeCity: row.home_city ?? null, homeState: row.home_state ?? null,
    starRating: row.star_rating, status: row.status, committedTeamId: row.committed_team_id ?? null, committedTeamExternal: row.committed_team_external ?? null,
    commitDate: row.commit_date ?? null, storyId: row.story_id ?? null,
  };
}

const SELECT_COLUMNS = "id,player_name,position,home_city,home_state,star_rating,status,committed_team_id,committed_team_external,commit_date,story_id";

export async function listRecruits(guildId: string): Promise<{ recruits: Recruit[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const result = await supabase.from("rec_recruiting_profiles").select(SELECT_COLUMNS).eq("league_id", context.leagueId).order("created_at", { ascending: false });
  if (result.error) throw new ApiError(500, "Failed to load recruits.", result.error);
  return { recruits: (result.data ?? []).map(mapRow) };
}

export async function createRecruit(input: { guildId: string; discordId: string; playerName: string; position: string; homeCity?: string | null; homeState?: string | null; starRating: number }): Promise<{ recruit: Recruit }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? 1);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), league_id: context.leagueId, season_number: seasonNumber,
    player_name: input.playerName.trim(), position: input.position.trim(),
    home_city: input.homeCity?.trim() || null, home_state: input.homeState?.trim() || null,
    star_rating: input.starRating, status: "uncommitted", created_by_discord_id: input.discordId, created_at: now, updated_at: now,
  };
  const result = await supabase.from("rec_recruiting_profiles").insert(row).select(SELECT_COLUMNS).single();
  if (result.error) throw new ApiError(500, "Failed to add the recruit.", result.error);
  return { recruit: mapRow(result.data) };
}

export async function updateRecruitStatus(input: { guildId: string; id: string; status: RecruitStatus; committedTeamId?: string | null; committedTeamExternal?: string | null; commitDate?: string | null }): Promise<{ recruit: Recruit }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_recruiting_profiles").select("id,league_id,player_name,status").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the recruit.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Recruit not found.");

  const patch: Record<string, unknown> = { status: input.status, updated_at: new Date().toISOString() };
  if (input.status === "committed") {
    patch.committed_team_id = input.committedTeamId ?? null;
    patch.committed_team_external = input.committedTeamExternal ?? null;
    patch.commit_date = input.commitDate ?? new Date().toISOString().slice(0, 10);
  }

  // Only fire a headline the moment status actually transitions INTO committed — re-saving
  // an already-committed recruit (e.g. editing the commit date) shouldn't republish.
  const becameCommitted = input.status === "committed" && existing.data.status !== "committed";
  if (becameCommitted) {
    let teamName = input.committedTeamExternal?.trim() || "an outside program";
    if (input.committedTeamId) {
      const team = await supabase.from("rec_teams").select("name").eq("id", input.committedTeamId).maybeSingle();
      teamName = team.data?.name ?? teamName;
    }
    const headline = `${existing.data.player_name} Commits to ${teamName}`;
    const body = `${existing.data.player_name} has announced a commitment to ${teamName}, giving the program a fresh addition heading into the next signing period.`;
    const story = await publishTransitionStory({ guildId: input.guildId, headline, body, primaryAngle: "recruit_commitment" });
    patch.story_id = story.storyId;
  }

  const result = await supabase.from("rec_recruiting_profiles").update(patch).eq("id", input.id).select(SELECT_COLUMNS).single();
  if (result.error) throw new ApiError(500, "Failed to update the recruit.", result.error);
  return { recruit: mapRow(result.data) };
}

export async function deleteRecruit(input: { guildId: string; id: string }): Promise<{ deleted: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_recruiting_profiles").select("id,league_id").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the recruit.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Recruit not found.");
  const result = await supabase.from("rec_recruiting_profiles").delete().eq("id", input.id);
  if (result.error) throw new ApiError(500, "Failed to delete the recruit.", result.error);
  return { deleted: true };
}
