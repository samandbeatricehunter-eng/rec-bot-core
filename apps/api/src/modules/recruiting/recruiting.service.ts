import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

// A recruiting-stage pipeline, not just commit/decommit event outcomes: a prospect moves
// undecided -> visit_scheduled -> verbal_commit -> hard_commit -> signed, with
// recruiting_battle (multiple schools actively competing) and committed_elsewhere (left the
// board for a program outside this league) reachable as side states from any stage. Flipping
// a commit or reopening one is just changing committedTeamId / moving back to an earlier
// stage — there's no separate "flipped"/"decommitted" status.
export const RECRUIT_STATUSES = [
  "undecided", "visit_scheduled", "verbal_commit", "hard_commit", "signed",
  "recruiting_battle", "committed_elsewhere",
] as const;
export type RecruitStatus = (typeof RECRUIT_STATUSES)[number];

/** A commit-type stage — the recruit has a team, in-league or not. */
function isCommitStatus(status: RecruitStatus): boolean {
  return status === "verbal_commit" || status === "hard_commit" || status === "signed" || status === "committed_elsewhere";
}
export type Recruit = {
  id: string; playerName: string; position: string; homeCity: string | null; homeState: string | null;
  starRating: number; status: RecruitStatus; committedTeamId: string | null; committedTeamExternal: string | null;
  commitDate: string | null; storyId: string | null; heightInches: number | null; weightLbs: number | null;
  submittedByUserId: string | null;
};

function mapRow(row: any): Recruit {
  return {
    id: row.id, playerName: row.player_name, position: row.position, homeCity: row.home_city ?? null, homeState: row.home_state ?? null,
    starRating: row.star_rating, status: row.status, committedTeamId: row.committed_team_id ?? null, committedTeamExternal: row.committed_team_external ?? null,
    commitDate: row.commit_date ?? null, storyId: row.story_id ?? null, heightInches: row.height_inches ?? null, weightLbs: row.weight_lbs ?? null,
    submittedByUserId: row.submitted_by_user_id ?? null,
  };
}

const SELECT_COLUMNS = "id,player_name,position,home_city,home_state,star_rating,status,committed_team_id,committed_team_external,commit_date,story_id,height_inches,weight_lbs,submitted_by_user_id";

// Rough placeholder OVR from star rating (1-5) until the commissioner sets a real one via
// Edit Rosters — recruits carry no OVR field of their own, only a recruiting-grade star rating.
function ovrFromStarRating(starRating: number | null): number | null {
  if (!starRating) return null;
  return Math.max(55, Math.min(85, 55 + starRating * 6));
}

/** Materializes every signed, in-league-committed recruit into a real roster row — called when
 * a league advances into a new season's preseason (signing day has passed). Idempotent: a
 * recruit already linked to a rec_players row via source_recruit_id is never inserted twice. */
export async function materializeSignedRecruits(leagueId: string): Promise<{ materialized: number }> {
  const signed = await supabase.from("rec_recruiting_profiles")
    .select("id,player_name,first_name,last_name,position,height_inches,weight_lbs,star_rating,committed_team_id")
    .eq("league_id", leagueId).eq("status", "signed").not("committed_team_id", "is", null);
  if (signed.error) throw new ApiError(500, "Failed to load signed recruits.", signed.error);
  const recruits = signed.data ?? [];
  if (!recruits.length) return { materialized: 0 };

  const already = await supabase.from("rec_players").select("source_recruit_id")
    .eq("league_id", leagueId).in("source_recruit_id", recruits.map((r) => r.id));
  if (already.error) throw new ApiError(500, "Failed to check already-materialized recruits.", already.error);
  const materializedIds = new Set((already.data ?? []).map((row: any) => row.source_recruit_id));

  let materialized = 0;
  for (const recruit of recruits) {
    if (materializedIds.has(recruit.id)) continue;
    const nameParts = String(recruit.player_name ?? "").trim().split(/\s+/);
    const firstName = recruit.first_name?.trim() || nameParts[0] || "Unknown";
    const lastName = recruit.last_name?.trim() || nameParts.slice(1).join(" ") || "Recruit";
    const inserted = await supabase.from("rec_players").insert({
      league_id: leagueId,
      team_id: recruit.committed_team_id,
      source_recruit_id: recruit.id,
      madden_player_id: `recruit:${leagueId}:${recruit.id}`,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      position: recruit.position,
      height_inches: recruit.height_inches ?? null,
      weight_lbs: recruit.weight_lbs ?? null,
      overall_rating: ovrFromStarRating(recruit.star_rating),
      is_free_agent: false,
      is_default_player: false,
      player_source: "signed_recruit",
      roster_status: "active",
      status_changed_at: new Date().toISOString(),
      raw_payload: {},
    });
    if (inserted.error) { console.error("[ERROR] Failed to materialize signed recruit:", recruit.id, inserted.error); continue; }
    materialized += 1;
  }
  return { materialized };
}

export async function listRecruits(guildId: string): Promise<{ recruits: Recruit[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const result = await supabase.from("rec_recruiting_profiles").select(SELECT_COLUMNS).eq("league_id", context.leagueId).order("created_at", { ascending: false });
  if (result.error) throw new ApiError(500, "Failed to load recruits.", result.error);
  return { recruits: (result.data ?? []).map(mapRow) };
}

async function userIdFromDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  return account.data?.user_id ?? null;
}

async function teamForUser(leagueId: string, userId: string) {
  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(403, "A linked league team is required.");
  return String(assignment.data.team_id);
}

export async function listRecruitingTeams(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const teams = await supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", context.leagueId).order("name");
  if (teams.error) throw new ApiError(500, "Failed to load teams.", teams.error);
  return (teams.data ?? []).map((t: any) => ({ id: t.id, name: t.name, abbreviation: t.display_abbr || t.abbreviation }));
}

// My team's saved watch-list — pre-commit prospects a coach has explicitly added to track,
// distinct from the full recruit pool. `teamId` lets a coach view another team's board (the
// "toggle another team" dropdown); defaults to their own.
export async function listRecruitingBoard(input: { guildId: string; discordId: string; teamId?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  let teamId = input.teamId;
  if (!teamId) {
    const userId = await userIdFromDiscord(input.discordId);
    if (!userId) return { recruits: [] as Recruit[] };
    teamId = await teamForUser(context.leagueId, userId);
  }
  const entries = await supabase.from("rec_recruiting_board_entries").select("recruit_id").eq("league_id", context.leagueId).eq("team_id", teamId);
  if (entries.error) throw new ApiError(500, "Failed to load the recruiting board.", entries.error);
  const recruitIds = (entries.data ?? []).map((e) => e.recruit_id);
  if (!recruitIds.length) return { recruits: [] as Recruit[] };
  const recruits = await supabase.from("rec_recruiting_profiles").select(SELECT_COLUMNS).in("id", recruitIds);
  if (recruits.error) throw new ApiError(500, "Failed to load board recruits.", recruits.error);
  return { recruits: (recruits.data ?? []).map(mapRow) };
}

export async function addRecruitToBoard(input: { guildId: string; discordId: string; recruitId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  if (!userId) throw new ApiError(404, "REC account not found.");
  const teamId = await teamForUser(context.leagueId, userId);
  const recruit = await supabase.from("rec_recruiting_profiles").select("id,league_id").eq("id", input.recruitId).maybeSingle();
  if (recruit.error) throw new ApiError(500, "Failed to load recruit.", recruit.error);
  if (!recruit.data || recruit.data.league_id !== context.leagueId) throw new ApiError(404, "Recruit not found.");
  const { error } = await supabase.from("rec_recruiting_board_entries").upsert(
    { league_id: context.leagueId, team_id: teamId, recruit_id: input.recruitId, added_by_user_id: userId },
    { onConflict: "team_id,recruit_id" },
  );
  if (error) throw new ApiError(500, "Failed to add recruit to your board.", error);
  return { ok: true as const };
}

export async function removeRecruitFromBoard(input: { guildId: string; discordId: string; recruitId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  if (!userId) throw new ApiError(404, "REC account not found.");
  const teamId = await teamForUser(context.leagueId, userId);
  const { error } = await supabase.from("rec_recruiting_board_entries").delete().eq("team_id", teamId).eq("recruit_id", input.recruitId);
  if (error) throw new ApiError(500, "Failed to remove recruit from your board.", error);
  return { ok: true as const };
}

export async function createRecruit(input: { guildId: string; discordId: string; playerName: string; position: string; homeCity?: string | null; homeState?: string | null; starRating: number; heightInches?: number | null; weightLbs?: number | null }): Promise<{ recruit: Recruit }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? 1);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), league_id: context.leagueId, season_number: seasonNumber,
    player_name: input.playerName.trim(), position: input.position.trim(),
    home_city: input.homeCity?.trim() || null, home_state: input.homeState?.trim() || null,
    star_rating: input.starRating, status: "undecided", created_by_discord_id: input.discordId, created_at: now, updated_at: now,
    height_inches: input.heightInches ?? null, weight_lbs: input.weightLbs ?? null,
  };
  const result = await supabase.from("rec_recruiting_profiles").insert(row).select(SELECT_COLUMNS).single();
  if (result.error) throw new ApiError(500, "Failed to add the recruit.", result.error);
  return { recruit: mapRow(result.data) };
}

export async function submitRecruitCommit(input: { guildId: string; discordId: string; playerName: string; position: string; homeCity: string; homeState: string; starRating: number }): Promise<{ recruit: Recruit }> {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "cfb_27") throw new ApiError(400, "Recruiting commits are available only in College Football leagues.");
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  if (!account.data?.user_id) throw new ApiError(400, "Link a REC team before submitting a recruit.");
  const assignment = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.leagueId).eq("user_id", account.data.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(400, "Link a team before submitting a recruit.");

  const now = new Date().toISOString();
  const playerName = input.playerName.trim().replace(/\s+/g, " ");
  const [firstName, ...lastParts] = playerName.split(" ");
  if (!firstName || !lastParts.length) throw new ApiError(400, "Enter the recruit's first and last name.");
  const id = randomUUID();
  const row = {
    id, league_id: context.leagueId, season_number: Number(context.rec_leagues.season_number ?? 1),
    player_name: playerName, first_name: firstName, last_name: lastParts.join(" "), normalized_full_name: playerName.toLowerCase(),
    position: input.position, home_city: input.homeCity.trim(), home_state: input.homeState.trim(), star_rating: input.starRating,
    status: "hard_commit", committed_team_id: assignment.data.team_id, commit_date: now.slice(0, 10), committed_at: now,
    created_by_discord_id: input.discordId, submitted_by_user_id: account.data.user_id, submitted_by_discord_id: input.discordId,
    created_at: now, updated_at: now,
  };
  const result = await supabase.from("rec_recruiting_profiles").insert(row).select(SELECT_COLUMNS).single();
  if (result.error) throw new ApiError(500, "Failed to save the recruiting commitment.", result.error);
  await supabase.from("rec_recruiting_commitment_history").insert({ recruit_id: id, league_id: context.leagueId, to_status: "hard_commit", to_team_id: assignment.data.team_id, changed_by_discord_id: input.discordId, snapshot: row });
  const team = await supabase.from("rec_teams").select("name").eq("id", assignment.data.team_id).maybeSingle();
  const story = await publishTransitionStory({ guildId: input.guildId, headline: `${playerName} Commits to ${team.data?.name ?? "a new program"}`, body: `${input.starRating}-star ${input.position} ${playerName} from ${input.homeCity}, ${input.homeState} has committed to ${team.data?.name ?? "the program"}.`, primaryAngle: "recruit_commitment" });
  await supabase.from("rec_recruiting_profiles").update({ story_id: story.storyId }).eq("id", id);
  return { recruit: { ...mapRow(result.data), storyId: story.storyId } };
}

// Commissioner-only edit of the recruit's own details (name/position/star rating/hometown)
// — separate from updateRecruitStatus, which only ever touches status/commit fields. Doesn't
// republish a headline; a details correction (fixing a typo'd name, etc.) isn't news.
export async function updateRecruitDetails(input: { guildId: string; id: string; playerName: string; position: string; starRating: number; homeCity?: string | null; homeState?: string | null }): Promise<{ recruit: Recruit }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_recruiting_profiles").select("id,league_id").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the recruit.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Recruit not found.");

  const result = await supabase
    .from("rec_recruiting_profiles")
    .update({
      player_name: input.playerName.trim(), position: input.position.trim(), star_rating: input.starRating,
      home_city: input.homeCity?.trim() || null, home_state: input.homeState?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select(SELECT_COLUMNS)
    .single();
  if (result.error) throw new ApiError(500, "Failed to update the recruit's details.", result.error);
  return { recruit: mapRow(result.data) };
}

export async function updateRecruitStatus(input: { guildId: string; id: string; status: RecruitStatus; committedTeamId?: string | null; committedTeamExternal?: string | null; commitDate?: string | null }): Promise<{ recruit: Recruit }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_recruiting_profiles").select("id,league_id,player_name,status,committed_team_id").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the recruit.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Recruit not found.");

  const patch: Record<string, unknown> = { status: input.status, updated_at: new Date().toISOString() };
  if (isCommitStatus(input.status)) {
    if (input.status === "committed_elsewhere") {
      patch.committed_team_id = null;
      patch.committed_team_external = input.committedTeamExternal ?? null;
    } else {
      patch.committed_team_id = input.committedTeamId ?? null;
      patch.committed_team_external = null;
    }
    patch.commit_date = input.commitDate ?? new Date().toISOString().slice(0, 10);
  } else {
    // Moving back to a non-commit stage (undecided/visit_scheduled/recruiting_battle) clears
    // any previously-set team so a stale commitment doesn't linger on the board.
    patch.committed_team_id = null;
    patch.committed_team_external = null;
    patch.commit_date = null;
  }

  // Only fire a headline the moment status actually transitions INTO a commit stage —
  // re-saving an already-committed recruit (e.g. editing the commit date) shouldn't republish.
  const becameCommitted = isCommitStatus(input.status) && !isCommitStatus(existing.data.status as RecruitStatus);
  if (becameCommitted && input.status !== "committed_elsewhere") {
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
  await supabase.from("rec_recruiting_commitment_history").insert({
    recruit_id: input.id, league_id: context.leagueId, from_status: existing.data.status, to_status: input.status,
    from_team_id: existing.data.committed_team_id, to_team_id: input.committedTeamId ?? existing.data.committed_team_id,
    snapshot: result.data,
  });
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
