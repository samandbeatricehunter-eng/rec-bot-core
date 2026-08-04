import { CFB_POSITION_GROUPS, normalizeCfbPosition, overallToGrade } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { listDraftPicksForTeam } from "../draft-picks/draft-picks.service.js";

export const ROSTER_DEPARTURE_STATUSES = ["drafted", "transferred_out", "retired", "graduated"] as const;
export type RosterDepartureStatus = (typeof ROSTER_DEPARTURE_STATUSES)[number];

async function userIdForDiscord(discordId: string) {
  const result = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load your REC account.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

async function resolveTargetTeamId(leagueId: string, userId: string, requestedTeamId?: string | null) {
  if (requestedTeamId) {
    const team = await supabase.from("rec_teams").select("id").eq("league_id", leagueId).eq("id", requestedTeamId).maybeSingle();
    if (team.error) throw new ApiError(500, "Failed to load team.", team.error);
    if (!team.data) throw new ApiError(404, "Team not found in this league.");
    return requestedTeamId;
  }
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(404, "You are not linked to a team in this league.");
  return assignment.data.team_id as string;
}

export type RosterPlayer = {
  id: string;
  fullName: string;
  position: string;
  positionGroup: string;
  heightInches: number | null;
  weightLbs: number | null;
  classYear: string | null;
  overallRating: number | null;
  rosterStatus: string;
  isDefaultPlayer: boolean;
  recentIncrease: null;
};

export type RosterPositionGroup = {
  group: string;
  grade: string;
  avgOverall: number | null;
  playerCount: number;
};

export async function getTeamRoster(input: { guildId: string; discordId: string; teamId?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);
  const teamId = await resolveTargetTeamId(leagueId, userId, input.teamId);

  const team = await supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,is_relocated").eq("id", teamId).single();
  if (team.error) throw new ApiError(500, "Failed to load team.", team.error);

  const players = await supabase
    .from("rec_players")
    .select("id,full_name,position,height_inches,weight_lbs,class_year,overall_rating,roster_status,is_default_player")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .order("position", { ascending: true })
    .order("overall_rating", { ascending: false });
  if (players.error) throw new ApiError(500, "Failed to load roster.", players.error);

  const rows: RosterPlayer[] = (players.data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name ?? "Unknown",
    position: p.position ?? "",
    positionGroup: normalizeCfbPosition(p.position ?? ""),
    heightInches: p.height_inches,
    weightLbs: p.weight_lbs,
    classYear: p.class_year,
    overallRating: p.overall_rating,
    rosterStatus: p.roster_status ?? "active",
    isDefaultPlayer: Boolean(p.is_default_player),
    // Recorded OVR/attribute increases aren't logged yet (self-report + commissioner-approve
    // flow is a separate, not-yet-built feature) — always null until that lands.
    recentIncrease: null,
  }));

  const activeRows = rows.filter((r) => r.rosterStatus === "active" || r.rosterStatus === "transferred_in");
  const groups: RosterPositionGroup[] = CFB_POSITION_GROUPS.map((group) => {
    const inGroup = activeRows.filter((r) => r.positionGroup === group);
    const withOverall = inGroup.filter((r) => r.overallRating != null);
    const avgOverall = withOverall.length
      ? Math.round((withOverall.reduce((sum, r) => sum + (r.overallRating ?? 0), 0) / withOverall.length) * 10) / 10
      : null;
    return {
      group,
      grade: overallToGrade(avgOverall),
      avgOverall,
      playerCount: inGroup.length,
    };
  });

  // Draft picks are a Madden-only asset (CFB leagues use recruiting/transfer portal instead)
  // shown as their own "position group" alongside the real position groups, per how coaches
  // already browse rosters here.
  const isMadden = context.rec_leagues.game?.startsWith("madden") ?? false;
  const draftPicks = isMadden ? await listDraftPicksForTeam(input.guildId, teamId) : [];
  const positionGroups = isMadden
    ? [...groups, { group: "Draft Picks", grade: "—", avgOverall: null, playerCount: draftPicks.length }]
    : groups;

  return {
    team: {
      id: team.data.id,
      name: team.data.name,
      abbreviation: team.data.display_abbr || team.data.abbreviation,
    },
    players: rows,
    positionGroups,
    draftPicks,
  };
}

/** True if the requester may manage this team's roster — its own coach, or a co-commissioner+. */
async function assertCanManageTeamRoster(guildId: string, discordId: string, leagueId: string, userId: string, teamId: string) {
  const isCommish = await assertGuildPermission(guildId, discordId, "co_commissioner").then(() => true).catch(() => false);
  if (isCommish) return;
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to check team assignment.", assignment.error);
  if (assignment.data?.team_id !== teamId) {
    throw new ApiError(403, "Only that team's coach or a commissioner can manage this roster.");
  }
}

/** Mark a departing player drafted/transferred out/retired/graduated — never touches active
 * roster math destructively, just flips roster_status so the roster viewer (and later, editorial
 * signals) can tell who's still on the team. */
export async function setPlayerDeparture(input: {
  guildId: string;
  discordId: string;
  playerId: string;
  status: RosterDepartureStatus;
  note?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id,league_id").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");

  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, player.data.team_id);

  const updated = await supabase
    .from("rec_players")
    .update({ roster_status: input.status, status_changed_at: new Date().toISOString(), status_note: input.note?.trim() || null })
    .eq("id", input.playerId)
    .select("id,full_name,roster_status")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to update player status.", updated.error);
  return updated.data;
}

/** Reinstate a player accidentally marked as departed, or one who "stayed another year" after
 * being logged as entering the portal — back to active with no status note. */
export async function reinstatePlayer(input: { guildId: string; discordId: string; playerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");

  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, player.data.team_id);

  const updated = await supabase
    .from("rec_players")
    .update({ roster_status: "active", status_changed_at: new Date().toISOString(), status_note: null })
    .eq("id", input.playerId)
    .select("id,full_name,roster_status")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to reinstate player.", updated.error);
  return updated.data;
}

/** Log an incoming transfer — a brand-new rec_players row, never a baseline/default player
 * (is_default_player stays false), so it's naturally exempt from the default-player purchase
 * restriction that's planned for the attribute-upgrade flow. */
export async function addTransferInPlayer(input: {
  guildId: string;
  discordId: string;
  teamId: string;
  firstName: string;
  lastName: string;
  position: string;
  classYear?: string | null;
  overallRating?: number | null;
  note?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);
  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, input.teamId);

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ApiError(400, "First and last name are required.");
  const position = input.position.trim().toUpperCase();
  if (!position) throw new ApiError(400, "Position is required.");

  const inserted = await supabase
    .from("rec_players")
    .insert({
      league_id: leagueId,
      team_id: input.teamId,
      madden_player_id: `transfer:${leagueId}:${crypto.randomUUID()}`,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      position,
      class_year: input.classYear ?? null,
      overall_rating: input.overallRating ?? null,
      is_free_agent: false,
      is_default_player: false,
      roster_status: "transferred_in",
      status_changed_at: new Date().toISOString(),
      status_note: input.note?.trim() || null,
      raw_payload: {},
    })
    .select("id,full_name,roster_status")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to log incoming transfer.", inserted.error);
  return inserted.data;
}
