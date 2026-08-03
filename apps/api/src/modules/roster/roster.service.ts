import { CFB_POSITION_GROUPS, normalizeCfbPosition, overallToGrade } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

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

  return {
    team: {
      id: team.data.id,
      name: team.data.name,
      abbreviation: team.data.display_abbr || team.data.abbreviation,
    },
    players: rows,
    positionGroups: groups,
  };
}
