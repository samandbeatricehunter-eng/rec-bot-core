import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { linkUserToTeam } from "../team-ownership/team-ownership.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

export async function createTeamLinkRequest(input: { guildId: string; discordId: string; teamId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;

  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);

  let userId = account.data?.user_id;
  if (!userId) {
    const createdUser = await supabase.from("rec_users").insert({ display_name: input.discordId, status: "active" }).select("id").single();
    if (createdUser.error) throw new ApiError(500, "Failed to create REC user.", createdUser.error);
    userId = createdUser.data.id;
    const createdAccount = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: userId, discord_id: input.discordId, username: input.discordId, global_name: input.discordId })
      .select("user_id")
      .single();
    if (createdAccount.error) {
      // Roll back the just-created rec_users row rather than leaving it orphaned with no linked account.
      await supabase.from("rec_users").delete().eq("id", userId);
      throw new ApiError(500, "Failed to link Discord account.", createdAccount.error);
    }
  }

  const existingAssignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (existingAssignment.error) throw new ApiError(500, "Failed to check existing assignment.", existingAssignment.error);
  if (existingAssignment.data) throw new ApiError(409, "You are already linked to a team in this league.");

  const team = await supabase
    .from("rec_teams")
    .select("*")
    .eq("id", input.teamId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (team.error) throw new ApiError(500, "Failed to load team.", team.error);
  if (!team.data) throw new ApiError(404, "Team not found in this league.");

  const teamTaken = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("team_id", input.teamId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (teamTaken.error) throw new ApiError(500, "Failed to check team availability.", teamTaken.error);
  if (teamTaken.data) throw new ApiError(409, "That team is no longer available.");

  const pending = await supabase
    .from("rec_team_link_requests")
    .select("id")
    .eq("league_id", leagueId)
    .eq("requester_user_id", userId)
    .in("status", ["pending", "approved"])
    .maybeSingle();
  if (pending.error) throw new ApiError(500, "Failed to check pending requests.", pending.error);
  if (pending.data) throw new ApiError(409, "You already have a pending team request.");

  const inserted = await supabase
    .from("rec_team_link_requests")
    .insert({
      guild_id: input.guildId,
      league_id: leagueId,
      team_id: input.teamId,
      requester_user_id: userId,
      requester_discord_id: input.discordId,
      status: "pending",
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to create team request.", inserted.error);

  const teamName = formatTeamDisplayName(team.data) ?? team.data.name;
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: leagueId,
    season_number: null,
    week_number: null,
    queue_type: "team_request",
    status: "pending",
    priority: 0,
    header: teamName ? `Team link request: ${teamName}` : "Team link request",
    summary: `Requested by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    team_id: input.teamId,
    source_table: "rec_team_link_requests",
    source_id: inserted.data.id,
    payload: { requestId: inserted.data.id, teamId: input.teamId },
  });

  return {
    request: inserted.data,
    teamName: formatTeamDisplayName(team.data) ?? team.data.name,
    leagueName: context.rec_leagues.name ?? null,
  };
}

export async function getTeamLinkRequest(requestId: string) {
  const { data, error } = await supabase
    .from("rec_team_link_requests")
    .select("*,team:rec_teams(*)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load team request.", error);
  if (!data) throw new ApiError(404, "Team request not found.");
  return data;
}

export async function approveTeamLinkRequest(input: { requestId: string; reviewerDiscordId: string }) {
  const request = await getTeamLinkRequest(input.requestId);
  if (request.status !== "pending") throw new ApiError(409, "This request is no longer pending.");

  const updated = await supabase
    .from("rec_team_link_requests")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to approve team request.", updated.error);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString() })
    .eq("source_table", "rec_team_link_requests")
    .eq("source_id", input.requestId);

  const teamRow = await supabase.from("rec_teams").select("*").eq("id", request.team_id).maybeSingle();
  return {
    ...updated.data,
    team: teamRow.data ?? null,
    teamName: formatTeamDisplayName(teamRow.data) ?? teamRow.data?.name ?? "Team",
  };
}

export async function rejectTeamLinkRequest(input: { requestId: string; reviewerDiscordId: string }) {
  const request = await getTeamLinkRequest(input.requestId);
  if (!["pending", "approved"].includes(request.status)) throw new ApiError(409, "This request can no longer be rejected.");

  const updated = await supabase
    .from("rec_team_link_requests")
    .update({
      status: "rejected",
      assigned_by_discord_id: input.reviewerDiscordId,
      updated_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to reject team request.", updated.error);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "denied", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString() })
    .eq("source_table", "rec_team_link_requests")
    .eq("source_id", input.requestId);
  return updated.data;
}

export async function completeTeamLinkRequest(input: {
  requestId: string;
  authority: "member" | "co_commissioner" | "commissioner";
  reviewerDiscordId: string;
}) {
  const request = await getTeamLinkRequest(input.requestId);
  if (request.status !== "approved") throw new ApiError(409, "Approve the request before assigning a role.");

  const link = await linkUserToTeam({
    guildId: request.guild_id,
    discordId: request.requester_discord_id,
    teamId: request.team_id,
    authority: input.authority,
    requestedByDiscordId: input.reviewerDiscordId,
  });

  const reviewerAccount = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.reviewerDiscordId)
    .maybeSingle();

  const updated = await supabase
    .from("rec_team_link_requests")
    .update({
      status: "completed",
      authority: input.authority,
      assigned_by_discord_id: input.reviewerDiscordId,
      assigned_by_user_id: reviewerAccount.data?.user_id ?? null,
      updated_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to complete team request.", updated.error);

  return { request: updated.data, link };
}

export async function attachTeamLinkRequestMessage(input: {
  requestId: string;
  channelId: string;
  messageId: string;
}) {
  const { error } = await supabase
    .from("rec_team_link_requests")
    .update({
      review_channel_id: input.channelId,
      review_message_id: input.messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.requestId);
  if (error) throw new ApiError(500, "Failed to attach review message.", error);
  return { ok: true };
}
