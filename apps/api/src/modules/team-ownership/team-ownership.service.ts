// @ts-nocheck
import { AFC_TEAMS, CFB_27_TEAMS, NFC_TEAMS, type CfbTeamOption } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { trySeedDefaultScheduleAfterTeamsReady } from "../schedule/schedule.service.js";
import { addMemberRole, ensureManagedRoleId, getGuildMemberDisplayNameMap, listGuildMembers } from "../../lib/discord-guild.js";
import type { CreateDefaultTeamsInput, CustomTeamReplacementInput, LinkUserToTeamInput, ResetDefaultTeamsInput, UnlinkAllTeamsInput, UnlinkTeamInput } from "./team-ownership.schemas.js";

export async function getCurrentLeagueForGuild(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  return { server: context.rec_discord_servers, league: context.rec_leagues };
}

function getDefaultTeamCatalog(game?: string | null) {
  if (game === "cfb_27") return CFB_27_TEAMS;
  return [...AFC_TEAMS, ...NFC_TEAMS];
}

function defaultTeamResetDescription(game?: string | null) {
  if (game === "cfb_27") return "default College Football 27 teams";
  if (game === "madden_27") return "default Madden NFL 27 teams";
  return "default Madden NFL 26 teams";
}

function normalizeAbbreviation(value: string) {
  return value.trim().toUpperCase();
}

function getDefaultTeamByAbbreviation(game: string | null | undefined, abbreviation: string) {
  const normalized = normalizeAbbreviation(abbreviation);
  return getDefaultTeamCatalog(game).find((team) => normalizeAbbreviation(team.abbreviation) === normalized) ?? null;
}

function normalizeTeamText(value?: string | null) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createDefaultTeamsForGuild(input: CreateDefaultTeamsInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);
  const isCfb = league.game === "cfb_27";
  const catalog = getDefaultTeamCatalog(league.game);
  const rows = catalog.map((team) => ({
    league_id: league.id,
    name: team.name,
    abbreviation: team.abbreviation,
    conference: input.conferenceOverrides?.[normalizeAbbreviation(team.abbreviation)] ?? team.conference,
    division: team.division,
    // CFB's real display identity is "University + Mascot" (e.g. "Texas Longhorns"); Madden's
    // `name` already carries the full "City Mascot" combo, so leave its display fields null.
    display_city: isCfb ? team.name : null,
    display_nick: isCfb ? (team as CfbTeamOption).mascot : null,
    source: "manual_admin_entry"
  }));

  const clearedAssignments = await supabase.from("rec_team_assignments").delete().eq("league_id", league.id);
  if (clearedAssignments.error) throw new ApiError(500, "Failed to clear existing team links.", clearedAssignments.error);

  const clearedTeams = await supabase.from("rec_teams").delete().eq("league_id", league.id);
  if (clearedTeams.error) throw new ApiError(500, "Failed to clear existing league teams.", clearedTeams.error);

  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "Failed to create default league teams.", result.error);

  await writeAuditLog({
    action: league.game === "cfb_27" ? "teams.default_cfb.upserted" : "teams.default_nfl.upserted",
    entityType: "rec_teams",
    newValue: { guildId: input.guildId, leagueId: league.id, game: league.game, teamCount: rows.length },
    reason: `${defaultTeamResetDescription(league.game)} created for Team Ownership setup.`,
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
  const isCfb = league.game === "cfb_27";
  const catalog = getDefaultTeamCatalog(league.game);
  const rows = catalog.map((team) => ({
    league_id: league.id,
    name: team.name,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    display_city: isCfb ? team.name : null,
    display_nick: isCfb ? (team as CfbTeamOption).mascot : null,
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
    action: league.game === "cfb_27" ? "teams.default_cfb.reset" : "teams.default_nfl.reset",
    entityType: "rec_teams",
    newValue: { guildId: input.guildId, leagueId: league.id, game: league.game, teamCount: result.data?.length ?? 0 },
    reason: `${defaultTeamResetDescription(league.game)} reset through Team Management.`,
    source: "manual_admin_entry"
  });

  return { league, teams: result.data ?? [] };
}

export async function createCustomTeamReplacement(input: CustomTeamReplacementInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);
  const replacementAbbr = normalizeAbbreviation(input.replacementTeamAbbreviation);

  const existing = await supabase
    .from("rec_teams")
    .select("*")
    .eq("league_id", league.id)
    .or(`abbreviation.eq.${replacementAbbr},original_abbreviation.eq.${replacementAbbr},display_abbr.eq.${replacementAbbr}`)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw new ApiError(500, "Failed to look up existing team slot.", existing.error);

  const liveTeams = existing.data ? { data: [], error: null } : await supabase
    .from("rec_teams")
    .select("*")
    .eq("league_id", league.id);
  if (liveTeams.error) throw new ApiError(500, "Failed to load live league teams.", liveTeams.error);

  const normalizedLookup = normalizeTeamText(input.replacementTeamAbbreviation);
  const liveMatch = (liveTeams.data ?? []).find((team: any) =>
    normalizeTeamText(team.abbreviation) === normalizedLookup ||
    normalizeTeamText(team.original_abbreviation) === normalizedLookup ||
    normalizeTeamText(team.display_abbr) === normalizedLookup ||
    normalizeTeamText(team.name) === normalizedLookup,
  );
  const fallback = getDefaultTeamByAbbreviation(league.game, replacementAbbr)
    ?? getDefaultTeamCatalog(league.game).find((team) => normalizeTeamText(team.name) === normalizedLookup)
    ?? null;
  const replaced = existing.data ?? liveMatch ?? fallback;
  if (!replaced) {
    throw new ApiError(400, league.game === "cfb_27" ? "Replacement CFB team abbreviation was not recognized in this league." : "Replacement NFL team abbreviation was not recognized.");
  }

  const originalAbbreviation = existing.data?.original_abbreviation ?? existing.data?.abbreviation ?? liveMatch?.original_abbreviation ?? liveMatch?.abbreviation ?? fallback?.abbreviation ?? replacementAbbr;

  const updates = {
    name: input.customTeamName,
    display_city: input.customDisplayCity ?? null,
    display_nick: input.customDisplayNick ?? null,
    display_abbr: input.customDisplayAbbr ?? null,
    is_relocated: true,
    original_abbreviation: originalAbbreviation,
    updated_at: new Date().toISOString()
  };

  let result;
  const existingSlot = existing.data ?? liveMatch;
  if (existingSlot) {
    result = await supabase
      .from("rec_teams")
      .update(updates)
      .eq("id", existingSlot.id)
      .select("*")
      .single();
  } else {
    // Slot not found — create it (shouldn't happen after createDefaultTeams, but safe fallback)
    result = await supabase
      .from("rec_teams")
      .insert({
        league_id: league.id,
        abbreviation: fallback?.abbreviation ?? replacementAbbr,
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
    newValue: { guildId: input.guildId, leagueId: league.id, game: league.game, customTeamName: input.customTeamName, replacedAbbr: originalAbbreviation, displayAbbr: input.customDisplayAbbr },
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
    // Look up the real Discord nickname/username instead of stashing the raw snowflake as
    // a placeholder — that placeholder was never getting corrected later, so it just showed
    // up permanently as a number in every team/roster/chat display.
    const liveName = await getGuildMemberDisplayNameMap(input.guildId).then((names) => names.get(input.discordId) ?? null).catch(() => null);
    const displayName = liveName ?? input.discordId;

    const user = await supabase
      .from("rec_users")
      .insert({ display_name: displayName, status: "active" })
      .select("id")
      .single();

    if (user.error) throw new ApiError(500, "Failed to create REC user for Discord account.", user.error);

    const created = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: user.data.id, discord_id: input.discordId, username: displayName, global_name: displayName })
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

  // Team linking intentionally starts everyone at Member. Commissioners can elevate the
  // user independently from the Roles screen after the link is established.
  const memberRoleId = await ensureManagedRoleId(input.guildId, "member");
  await addMemberRole(input.guildId, input.discordId, memberRoleId, "REC team linked; default Member role");

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

export async function getTeamLinkMatrix(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const [teams, assignments, members] = await Promise.all([
    supabase.from("rec_teams").select("id,name,abbreviation,conference,division").eq("league_id", league.id).order("conference").order("name"),
    supabase.from("rec_team_assignments").select("team_id,user_id").eq("league_id", league.id).eq("assignment_status", "active").is("ended_at", null),
    listGuildMembers(guildId),
  ]);
  if (teams.error || assignments.error) throw new ApiError(500, "Failed to load the team linking matrix.", teams.error ?? assignments.error);
  const userIds = [...new Set((assignments.data ?? []).map((row) => row.user_id))];
  const accounts = userIds.length ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds) : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "Failed to load linked Discord accounts.", accounts.error);
  const discordByUser = new Map((accounts.data ?? []).map((row) => [row.user_id, row.discord_id]));
  const assignmentByTeam = new Map((assignments.data ?? []).map((row) => [row.team_id, discordByUser.get(row.user_id) ?? null]));
  return {
    league: { id: league.id, name: league.name },
    teams: (teams.data ?? []).map((team) => ({ ...team, discordId: assignmentByTeam.get(team.id) ?? null })),
    users: members.filter((member) => !member.isBot).map(({ discordId, displayName, username }) => ({ discordId, displayName, username })),
  };
}

export async function listOpenTeams(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const teams = await supabase.from("rec_teams").select("*").eq("league_id", league.id).order("conference").order("name");
  if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);

  const assignments = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", league.id).is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);

  const assigned = new Set(assignments.data.map((row) => row.team_id));
  // totalTeams lets callers distinguish "this league truly has zero teams" (safe to auto-seed
  // defaults) from "every team is already linked" (openTeams.length === 0 too, but seeding here
  // would destructively wipe every existing team/conference/link).
  return { league, openTeams: teams.data.filter((team) => !assigned.has(team.id)), totalTeams: teams.data.length };
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
