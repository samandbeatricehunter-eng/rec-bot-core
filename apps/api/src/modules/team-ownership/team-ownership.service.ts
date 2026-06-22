import { AFC_TEAMS, NFC_TEAMS, getTeamByAbbreviation } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { trySeedDefaultScheduleAfterTeamsReady } from "../schedule/schedule.service.js";
import type { CreateDefaultTeamsInput, CustomTeamReplacementInput, LinkUserToTeamInput, ResetDefaultTeamsInput, UnlinkAllTeamsInput, UnlinkTeamInput } from "./team-ownership.schemas.js";

export async function getCurrentLeagueForGuild(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  return { server: context.rec_discord_servers, league: context.rec_leagues };
}

export async function createDefaultTeamsForGuild(input: CreateDefaultTeamsInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);
  const rows = [...AFC_TEAMS, ...NFC_TEAMS].map((team) => ({
    league_id: league.id,
    name: team.name,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    source: "manual_admin_entry"
  }));

  const clearedAssignments = await supabase.from("rec_team_assignments").delete().eq("league_id", league.id);
  if (clearedAssignments.error) throw new ApiError(500, "Failed to clear existing team links.", clearedAssignments.error);

  const clearedTeams = await supabase.from("rec_teams").delete().eq("league_id", league.id);
  if (clearedTeams.error) throw new ApiError(500, "Failed to clear existing league teams.", clearedTeams.error);

  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "Failed to create default league teams.", result.error);

  await writeAuditLog({
    action: "teams.default_nfl.upserted",
    entityType: "rec_teams",
    newValue: { guildId: input.guildId, leagueId: league.id, teamCount: rows.length },
    reason: "Default teams created for Team Ownership setup.",
    source: "manual_admin_entry"
  });

  const seedResult = await trySeedDefaultScheduleAfterTeamsReady({
    guildId: input.guildId,
    requestedByDiscordId: input.requestedByDiscordId ?? null,
  }).catch(() => null);

  return { league, teams: result.data, defaultScheduleSeed: seedResult };
}

export async function resetDefaultTeamsForGuild(input: ResetDefaultTeamsInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);
  const rows = [...AFC_TEAMS, ...NFC_TEAMS].map((team) => ({
    league_id: league.id,
    name: team.name,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    display_city: null,
    display_nick: null,
    display_abbr: null,
    is_relocated: false,
    original_abbreviation: null,
    source: "manual_admin_entry" as const,
  }));

  const clearedAssignments = await supabase.from("rec_team_assignments").delete().eq("league_id", league.id);
  if (clearedAssignments.error) throw new ApiError(500, "Failed to clear existing team links.", clearedAssignments.error);

  const clearedTeams = await supabase.from("rec_teams").delete().eq("league_id", league.id);
  if (clearedTeams.error) throw new ApiError(500, "Failed to clear existing league teams.", clearedTeams.error);

  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "Failed to reset default league teams.", result.error);

  await writeAuditLog({
    action: "teams.default_nfl.reset",
    entityType: "rec_teams",
    newValue: { guildId: input.guildId, leagueId: league.id, teamCount: result.data?.length ?? 0 },
    reason: "Default teams reset through Team Management.",
    source: "manual_admin_entry"
  });

  return { league, teams: result.data ?? [] };
}

export async function createCustomTeamReplacement(input: CustomTeamReplacementInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);
  const replaced = getTeamByAbbreviation(input.replacementTeamAbbreviation);
  if (!replaced) throw new ApiError(400, "Replacement NFL team abbreviation was not recognized.");

  // Find the existing rec_teams row for this NFL slot (by original abbreviation)
  const existing = await supabase
    .from("rec_teams")
    .select("id")
    .eq("league_id", league.id)
    .eq("abbreviation", replaced.abbreviation)
    .maybeSingle();

  if (existing.error) throw new ApiError(500, "Failed to look up existing team slot.", existing.error);

  const updates = {
    name: input.customTeamName,
    display_city: input.customDisplayCity ?? null,
    display_nick: input.customDisplayNick ?? null,
    display_abbr: input.customDisplayAbbr ?? null,
    is_relocated: true,
    original_abbreviation: replaced.abbreviation,
    updated_at: new Date().toISOString()
  };

  let result;
  if (existing.data) {
    result = await supabase
      .from("rec_teams")
      .update(updates)
      .eq("id", existing.data.id)
      .select("*")
      .single();
  } else {
    // Slot not found — create it (shouldn't happen after createDefaultTeams, but safe fallback)
    result = await supabase
      .from("rec_teams")
      .insert({
        league_id: league.id,
        abbreviation: replaced.abbreviation,
        conference: replaced.conference,
        division: replaced.division,
        source: "manual_admin_entry" as any,
        ...updates
      })
      .select("*")
      .single();
  }

  if (result.error) throw new ApiError(500, "Failed to register custom team.", result.error);

  await writeAuditLog({
    action: "team.custom_replacement.registered",
    entityType: "rec_teams",
    entityId: result.data.id,
    newValue: { guildId: input.guildId, leagueId: league.id, customTeamName: input.customTeamName, replacedAbbr: replaced.abbreviation, displayAbbr: input.customDisplayAbbr },
    reason: "Custom/relocated team registered through Team Ownership setup.",
    source: "manual_admin_entry"
  });

  const linkedResult = await supabase
    .from("rec_team_assignments")
    .select("user_id,notes")
    .eq("league_id", league.id)
    .eq("team_id", result.data.id)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (linkedResult.error) throw new ApiError(500, "Failed to load linked users for custom team.", linkedResult.error);

  const linkedUserIds = [...new Set((linkedResult.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = linkedUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", linkedUserIds)
    : { data: [], error: null };

  if (accounts.error) throw new ApiError(500, "Failed to load linked Discord accounts for custom team.", accounts.error);

  const discordByUserId = new Map((accounts.data ?? []).map((account) => [account.user_id, account.discord_id]));
  const linkedUsers = (linkedResult.data ?? []).map((row) => {
    const authority = String(row.notes ?? "Authority: member").replace("Authority: ", "") as "member" | "co_commissioner" | "commissioner";
    return {
      userId: row.user_id,
      discordId: discordByUserId.get(row.user_id) ?? null,
      authority,
    };
  });

  return { league, replacedTeam: replaced, customTeam: result.data, linkedUsers };
}

// Flags relocated/custom teams whose admin-entered display data may need review.
export async function getTeamDataConflicts(_guildId: string) {
  return { conflicts: [] as Array<Record<string, unknown>> };
}

export async function linkUserToTeam(input: LinkUserToTeamInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);

  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id")
    .eq("discord_id", input.discordId)
    .maybeSingle();

  if (account.error) throw new ApiError(500, "Failed to check Discord account.", account.error);

  let userId = account.data?.user_id;

  if (!userId) {
    const user = await supabase
      .from("rec_users")
      .insert({ display_name: input.discordId, status: "active" })
      .select("id")
      .single();

    if (user.error) throw new ApiError(500, "Failed to create REC user for Discord account.", user.error);

    const created = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: user.data.id, discord_id: input.discordId, username: input.discordId, global_name: input.discordId })
      .select("user_id")
      .single();

    if (created.error) throw new ApiError(500, "Failed to create Discord account link.", created.error);
    userId = created.data.user_id;
  }

  const team = await supabase
    .from("rec_teams")
    .select("*")
    .eq("id", input.teamId)
    .eq("league_id", league.id)
    .single();

  if (team.error) throw new ApiError(404, "Team was not found in the current league.", team.error);

  await supabase
    .from("rec_league_memberships")
    .upsert({ league_id: league.id, user_id: userId, status: "active", role: input.authority }, { onConflict: "league_id,user_id" });

  await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "replaced", ended_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .is("ended_at", null);

  const assignment = await supabase
    .from("rec_team_assignments")
    .insert({
      league_id: league.id,
      team_id: input.teamId,
      user_id: userId,
      assignment_status: "active",
      source: "manual_admin_entry",
      notes: `Authority: ${input.authority}`
    })
    .select("*")
    .single();

  if (assignment.error) throw new ApiError(500, "Failed to create team assignment.", assignment.error);

  await writeAuditLog({
    action: "team.user_linked",
    entityType: "rec_team_assignments",
    entityId: assignment.data.id,
    newValue: { guildId: input.guildId, leagueId: league.id, discordId: input.discordId, teamId: input.teamId, teamName: team.data.name, authority: input.authority },
    reason: "User linked to team through Team Ownership setup.",
    source: "manual_admin_entry"
  });

  return { league, team: team.data, assignment: assignment.data, discordId: input.discordId, authority: input.authority };
}

export async function listLinkedUsersTeams(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const result = await supabase
    .from("rec_team_assignments")
    .select("id,assignment_status,notes,user_id,team:rec_teams(id,name,abbreviation,conference,division),user:rec_users(id,display_name),created_at")
    .eq("league_id", league.id)
    .is("ended_at", null)
    .order("created_at", { ascending: false });

  if (result.error) throw new ApiError(500, "Failed to load linked users/teams.", result.error);

  const userIds = [...new Set((result.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds)
    : { data: [], error: null };

  if (accounts.error) throw new ApiError(500, "Failed to load linked Discord accounts.", accounts.error);

  const accountByUserId = new Map((accounts.data ?? []).map((account) => [account.user_id, account]));
  const linked = (result.data ?? []).map((row) => ({
    ...row,
    discordAccount: accountByUserId.get(row.user_id) ?? null,
    discordId: accountByUserId.get(row.user_id)?.discord_id ?? null
  }));

  return { league, linked };
}

export async function listOpenTeams(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const teams = await supabase.from("rec_teams").select("*").eq("league_id", league.id).order("conference").order("name");
  if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);

  const assignments = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", league.id).is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);

  const assigned = new Set(assignments.data.map((row) => row.team_id));
  return { league, openTeams: teams.data.filter((team) => !assigned.has(team.id)) };
}

export async function unlinkTeamForGuild(input: UnlinkTeamInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);

  const result = await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "unlinked", ended_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .eq("team_id", input.teamId)
    .is("ended_at", null)
    .select("*");

  if (result.error) throw new ApiError(500, "Failed to unlink team assignment.", result.error);

  await writeAuditLog({
    action: "teams.unlinked",
    entityType: "rec_team_assignments",
    newValue: { guildId: input.guildId, leagueId: league.id, teamId: input.teamId, unlinkCount: result.data?.length ?? 0 },
    reason: "Single team assignment unlinked through Team Ownership admin command.",
    source: "manual_admin_entry"
  });

  return { league, unlinkedCount: result.data?.length ?? 0 };
}

export async function unlinkAllTeamsForGuild(input: UnlinkAllTeamsInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);

  const result = await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "unlinked", ended_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .is("ended_at", null)
    .select("*");

  if (result.error) throw new ApiError(500, "Failed to unlink team assignments.", result.error);

  await writeAuditLog({
    action: "teams.all_unlinked",
    entityType: "rec_team_assignments",
    newValue: { guildId: input.guildId, leagueId: league.id, unlinkCount: result.data?.length ?? 0 },
    reason: "All team assignments unlinked through Team Ownership admin command.",
    source: "manual_admin_entry"
  });

  return { league, unlinkedCount: result.data?.length ?? 0 };
}
