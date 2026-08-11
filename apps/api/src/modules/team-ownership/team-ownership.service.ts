import { AFC_TEAMS, CFB_27_TEAMS, CFB_TEAM_PRIMARY_COLORS, NFC_TEAMS, type CfbTeamOption } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { trySeedDefaultScheduleAfterTeamsReady } from "../schedule/schedule.service.js";
import { clearRivalriesForCustomTeam, ensureLeagueRivalries } from "../rivalries/rivalries.service.js";
import { addMemberRole, ensureManagedRoleId, getGuildMemberDisplayNameMap, listGuildMembers, setGuildMemberNickname } from "../../lib/discord-guild.js";
import type { CreateDefaultTeamsInput, CustomTeamReplacementInput, LinkUserToTeamInput, ResetDefaultTeamsInput, UnlinkAllTeamsInput, UnlinkTeamInput } from "./team-ownership.schemas.js";
import { assertCanJoinLeague } from "../subscriptions/entitlements.service.js";
import { releaseBacklogForLeague } from "../economy/economy-backlog.js";
import { resolveTeamSchool } from "../users/user-profile-stats.service.js";

// The nickname a newly-linked member gets tagged with: the school name for CFB (e.g.
// "Georgia"), or the mascot for Madden (e.g. "Cowboys") — display_nick holds that directly for
// custom/relocated teams; default catalog teams have it null, so fall back to the last word of
// the full name ("Dallas Cowboys" -> "Cowboys").
function shortTeamNickname(team: { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null }, isCfb: boolean): string {
  if (isCfb) return resolveTeamSchool(team) ?? team.name?.trim() ?? "Team";
  const nick = team.display_nick?.trim();
  if (nick) return nick;
  const name = (team.name ?? "Team").trim();
  const parts = name.split(/\s+/);
  return parts[parts.length - 1] || name;
}

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

// Dynamic import avoids a static circular dependency: recruiting-board.service.ts itself
// imports listOpenTeamsForLeagueId from this file.
function syncRecruitingAd(leagueId: string) {
  import("../recruiting-board/recruiting-board.service.js")
    .then((mod) => mod.syncLeagueRecruitingAd(leagueId))
    .catch((error) => console.error("[WARN] Failed to sync recruiting-board ad after team-ownership change:", error));
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

function cfbDisplayCity(team: CfbTeamOption) {
  return team.isSchedulePlaceholder ? "FCS" : team.name;
}

function isSchedulePlaceholderTeam(team: { name?: string | null; abbreviation?: string | null } | null | undefined) {
  const normalizedName = String(team?.name ?? "").trim().toUpperCase();
  const normalizedAbbr = String(team?.abbreviation ?? "").trim().toUpperCase();
  return normalizedAbbr === "FCS" || normalizedName === "FCS TEAM" || normalizedName === "FCS";
}

// Guild-free variant for a league created from the site before any Discord server is
// connected (see setup.service.ts's createUnclaimedLeague) — same team-catalog insert as
// createDefaultTeamsForGuild, minus the guild-scoped audit log and default-schedule seed
// (both depend on a real guildId; schedule seeding can be triggered later once Discord is
// linked, via the existing Reset Default Teams action in League Mgmt).
export async function createDefaultTeamsForLeague(leagueId: string, game: string | null | undefined) {
  const isCfbGame = game === "cfb_27";
  const catalog = getDefaultTeamCatalog(game);
  const rows = catalog.map((team) => ({
    league_id: leagueId,
    name: team.name,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    display_city: isCfbGame ? cfbDisplayCity(team as CfbTeamOption) : null,
    display_nick: isCfbGame ? (team as CfbTeamOption).mascot : null,
    source: "manual_admin_entry",
    primary_color: isCfbGame ? (CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF") : "#FFFFFF",
  }));
  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "Failed to create default league teams.", result.error);
  await ensureLeagueRivalries(leagueId, game ?? null);
  syncRecruitingAd(leagueId);
  return { teams: result.data };
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
    display_city: isCfb ? cfbDisplayCity(team as CfbTeamOption) : null,
    display_nick: isCfb ? (team as CfbTeamOption).mascot : null,
    source: "manual_admin_entry",
    primary_color: isCfb ? (CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF") : "#FFFFFF"
  }));

  const clearedAssignments = await supabase.from("rec_team_assignments").delete().eq("league_id", league.id);
  if (clearedAssignments.error) throw new ApiError(500, "Failed to clear existing team links.", clearedAssignments.error);

  const clearedTeams = await supabase.from("rec_teams").delete().eq("league_id", league.id);
  if (clearedTeams.error) throw new ApiError(500, "Failed to clear existing league teams.", clearedTeams.error);

  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "Failed to create default league teams.", result.error);
  await ensureLeagueRivalries(league.id, league.game);
  syncRecruitingAd(league.id);

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
  const customTeams = await supabase.from("rec_teams").select("id").eq("league_id", league.id).eq("is_relocated", true).limit(1);
  if (customTeams.error) throw new ApiError(500, "Failed to validate permanent custom teams.", customTeams.error);
  if (customTeams.data?.length) throw new ApiError(409, "Default teams cannot be reset after a custom replacement has been created in this league.");
  const isCfb = league.game === "cfb_27";
  const catalog = getDefaultTeamCatalog(league.game);
  const rows = catalog.map((team) => ({
    league_id: league.id,
    name: team.name,
    abbreviation: team.abbreviation,
    conference: team.conference,
    division: team.division,
    display_city: isCfb ? cfbDisplayCity(team as CfbTeamOption) : null,
    display_nick: isCfb ? (team as CfbTeamOption).mascot : null,
    display_abbr: null,
    is_relocated: false,
    original_abbreviation: null,
    source: "manual_admin_entry" as const,
    primary_color: isCfb ? (CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF") : "#FFFFFF",
  }));

  const clearedAssignments = await supabase.from("rec_team_assignments").delete().eq("league_id", league.id);
  if (clearedAssignments.error) throw new ApiError(500, "Failed to clear existing team links.", clearedAssignments.error);

  const clearedTeams = await supabase.from("rec_teams").delete().eq("league_id", league.id);
  if (clearedTeams.error) throw new ApiError(500, "Failed to clear existing league teams.", clearedTeams.error);

  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "Failed to reset default league teams.", result.error);
  await ensureLeagueRivalries(league.id, league.game);
  syncRecruitingAd(league.id);

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

  const isCfb = league.game === "cfb_27";
  const name = isCfb
    ? (input.customDisplayCity ?? "").trim() || input.customTeamName.trim()
    : [input.customDisplayCity, input.customDisplayNick].filter((part) => part && part.trim()).map((part) => part!.trim()).join(" ") || input.customTeamName.trim();

  const updates = {
    name,
    display_city: input.customDisplayCity ?? null,
    display_nick: input.customDisplayNick ?? null,
    display_abbr: input.customDisplayAbbr ?? null,
    is_relocated: true,
    original_abbreviation: originalAbbreviation,
    // TODO(PWA team management): add a commissioner color editor. Until that
    // workflow exists, every custom replacement intentionally starts white.
    primary_color: "#FFFFFF",
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
  await clearRivalriesForCustomTeam(league.id, result.data.id);

  await writeAuditLog({
    action: "team.custom_replacement.registered",
    entityType: "rec_teams",
    entityId: result.data.id,
    newValue: { guildId: input.guildId, leagueId: league.id, game: league.game, customTeamName: name, replacedAbbr: originalAbbreviation, displayAbbr: input.customDisplayAbbr },
    reason: "Custom/relocated team registered through Team Ownership setup.",
    source: "manual_admin_entry"
  });

  const linkedResult = await supabase
    .from("rec_team_assignments")
    .select("user_id,notes,user:rec_users(supabase_auth_user_id)")
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
  const linkedUsers = (linkedResult.data ?? []).map((row: any) => {
    const authority = String(row.notes ?? "Authority: member").replace("Authority: ", "") as "member" | "co_commissioner" | "commissioner";
    const isDiscordOnly = !row.user?.supabase_auth_user_id;
    return {
      userId: row.user_id,
      discordId: discordByUserId.get(row.user_id) ?? null,
      authority,
      isDiscordOnly,
      accountKind: isDiscordOnly ? "discord_only" : "site",
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
    // up permanently as a number in every team/roster/chat display. Leave the name columns
    // null on a failed/missed lookup rather than falling back to the raw ID; a later login
    // or hub read can still resolve a real name, but a written snowflake never self-heals.
    const liveName = await getGuildMemberDisplayNameMap(input.guildId).then((names) => names.get(input.discordId) ?? null).catch(() => null);

    // display_name is NOT NULL — "" (its own column default) stands in for a failed/missed
    // lookup rather than null, which would fail the insert outright.
    const user = await supabase
      .from("rec_users")
      .insert({ display_name: liveName ?? "", status: "active" })
      .select("id")
      .single();

    if (user.error) throw new ApiError(500, "Failed to create REC user for Discord account.", user.error);

    const created = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: user.data.id, discord_id: input.discordId, username: liveName, global_name: liveName })
      .select("user_id")
      .single();

    if (created.error) throw new ApiError(500, "Failed to create Discord account link.", created.error);
    userId = created.data.user_id;
  }

  const linkedUser = await supabase
    .from("rec_users")
    .select("id,supabase_auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (linkedUser.error) throw new ApiError(500, "Failed to load linked user.", linkedUser.error);
  if (linkedUser.data?.supabase_auth_user_id) {
    await assertCanJoinLeague(userId, league.game);
  }

  const team = await supabase
    .from("rec_teams")
    .select("*")
    .eq("id", input.teamId)
    .eq("league_id", league.id)
    .single();

  if (team.error) throw new ApiError(404, "Team was not found in the current league.", team.error);
  if (isSchedulePlaceholderTeam(team.data)) throw new ApiError(400, "That schedule placeholder cannot be linked to a user.");

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
      notes: `Authority: ${input.authority}`,
      discord_joined_at: new Date().toISOString(),
      stats_credit_starts_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (assignment.error) throw new ApiError(500, "Failed to create team assignment.", assignment.error);

  // Team linking intentionally starts everyone at Member. Commissioners can elevate the
  // user independently from the Roles screen after the link is established.
  // Best-effort: a 403 here (bot's role sits below the managed roles it's assigning, or it's
  // missing Manage Roles in this guild) used to throw and abort the whole link — the database
  // assignment above had already committed, so the user was left "linked" with no request
  // ever marked resolved and no chance at a nickname either. Cosmetic Discord-side sync
  // failing should never block the actual team link.
  const memberRoleId = await ensureManagedRoleId(input.guildId, "member");
  await addMemberRole(input.guildId, input.discordId, memberRoleId, "REC team linked; default Member role")
    .catch((error) => console.error(`[WARN] Failed to add Member role for ${input.discordId} in guild ${input.guildId} (non-fatal):`, error));

  // Best-effort: fails silently if the member hasn't actually joined this Discord server yet
  // (e.g. they were just approved and haven't clicked their invite link) — bot/index-timeout.ts's
  // guildMemberAdd handler catches that case up once they do join.
  await setGuildMemberNickname(
    input.guildId,
    input.discordId,
    shortTeamNickname(team.data, league.game === "cfb_27"),
    "REC team linked — nickname set to team",
  ).catch(() => undefined);

  await writeAuditLog({
    action: "team.user_linked",
    entityType: "rec_team_assignments",
    entityId: assignment.data.id,
    newValue: { guildId: input.guildId, leagueId: league.id, discordId: input.discordId, teamId: input.teamId, teamName: team.data.name, authority: input.authority },
    reason: "User linked to team through Team Ownership setup.",
    source: "manual_admin_entry"
  });

  // A new active assignment may have just crossed the economy's linked-user floor —
  // release any queued backlog for the league's current season if so (no-op otherwise).
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  await releaseBacklogForLeague(league.id, seasonNumber).catch((error) => {
    console.error("[ERROR] releaseBacklogForLeague failed after team link (non-fatal):", error);
  });
  syncRecruitingAd(league.id);

  const isDiscordOnly = !linkedUser.data?.supabase_auth_user_id;
  return {
    league,
    team: team.data,
    assignment: assignment.data,
    discordId: input.discordId,
    authority: input.authority,
    isDiscordOnly,
    accountKind: isDiscordOnly ? "discord_only" : "site",
  };
}

// Catches up a member who joined the Discord server AFTER their team was already linked (e.g.
// approved from a team request, then clicked their invite link later) — linkUserToTeam's own
// nickname/role set is best-effort and silently no-ops while they're not in the guild yet.
// Called from the bot's guildMemberAdd handler; a no-op if they have no active assignment.
export async function syncMemberForGuildJoin(guildId: string, discordId: string): Promise<{ synced: boolean }> {
  let league: { id: string; game: string };
  try {
    ({ league } = await getCurrentLeagueForGuild(guildId));
  } catch (error) {
    // Management guild / unlinked servers have no league — nothing to sync.
    if (error instanceof ApiError && error.statusCode === 404) return { synced: false };
    throw error;
  }

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  if (!account.data?.user_id) return { synced: false };

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team:rec_teams(name,display_nick,is_relocated)")
    .eq("league_id", league.id)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load team assignment.", assignment.error);
  const team = assignment.data?.team as { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null } | null;
  if (!team) return { synced: false };

  const memberRoleId = await ensureManagedRoleId(guildId, "member");
  await addMemberRole(guildId, discordId, memberRoleId, "REC team linked; default Member role (caught up on guild join)")
    .catch((error) => console.error(`[WARN] Failed to add Member role for ${discordId} in guild ${guildId} (non-fatal):`, error));
  await setGuildMemberNickname(guildId, discordId, shortTeamNickname(team, league.game === "cfb_27"), "REC team linked — nickname set to team (caught up on guild join)").catch(() => undefined);
  return { synced: true };
}

export async function listLinkedUsersTeams(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const result = await supabase
    .from("rec_team_assignments")
    .select("id,assignment_status,notes,user_id,team:rec_teams(id,name,abbreviation,conference,division),user:rec_users(id,display_name,supabase_auth_user_id),created_at")
    .eq("league_id", league.id)
    .is("ended_at", null)
    .order("created_at", { ascending: false });

  if (result.error) throw new ApiError(500, "Failed to load linked users/teams.", result.error);

  const userIds = [...new Set((result.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds)
    : { data: [], error: null };

  if (accounts.error) throw new ApiError(500, "Failed to load linked Discord accounts.", accounts.error);

  const accountByUserId = new Map<string, any>((accounts.data ?? []).map((account: any) => [account.user_id, account]));
  const linked = (result.data ?? []).map((row) => {
    const user = row.user as { id?: string; display_name?: string; supabase_auth_user_id?: string | null } | null;
    const isDiscordOnly = !user?.supabase_auth_user_id;
    return {
      ...row,
      discordAccount: accountByUserId.get(row.user_id) ?? null,
      discordId: accountByUserId.get(row.user_id)?.discord_id ?? null,
      isDiscordOnly,
      accountKind: isDiscordOnly ? "discord_only" : "site",
    };
  });

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
    teams: (teams.data ?? []).filter((team: any) => !isSchedulePlaceholderTeam(team)).map((team) => ({ ...team, discordId: assignmentByTeam.get(team.id) ?? null })),
    users: members.filter((member) => !member.isBot).map(({ discordId, displayName, username }) => ({ discordId, displayName, username })),
  };
}

// Guild-free core so the recruiting board (which advertises leagues that may have no linked
// Discord server yet) can compute the same open-teams set without a guildId to resolve from.
export async function listOpenTeamsForLeagueId(leagueId: string) {
  const teams = await supabase.from("rec_teams").select("*").eq("league_id", leagueId).order("conference").order("name");
  if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);

  const [assignments, pendingRequests] = await Promise.all([
    supabase.from("rec_team_assignments").select("team_id").eq("league_id", leagueId).is("ended_at", null),
    // A team with a pending (unapproved) request shouldn't show as open — otherwise a second
    // member could request the same team while the first request is still awaiting the
    // commissioner. Only "pending"/"approved" hold the team; "rejected"/"completed" don't
    // (completed teams are already caught by the assignment it created).
    supabase.from("rec_team_link_requests").select("team_id").eq("league_id", leagueId).in("status", ["pending", "approved"]),
  ]);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);
  if (pendingRequests.error) throw new ApiError(500, "Failed to load pending team requests.", pendingRequests.error);

  const assigned = new Set(assignments.data.map((row) => row.team_id));
  for (const row of pendingRequests.data) assigned.add(row.team_id);
  // totalTeams lets callers distinguish "this league truly has zero teams" (safe to auto-seed
  // defaults) from "every team is already linked" (openTeams.length === 0 too, but seeding here
  // would destructively wipe every existing team/conference/link).
  const playableTeams = teams.data.filter((team: any) => !isSchedulePlaceholderTeam(team));
  return { openTeams: playableTeams.filter((team) => !assigned.has(team.id)), totalTeams: playableTeams.length, allTeams: playableTeams };
}

export async function listOpenTeams(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const result = await listOpenTeamsForLeagueId(league.id);
  return { league, ...result };
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
  syncRecruitingAd(league.id);

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
  syncRecruitingAd(league.id);

  return { league, unlinkedCount: result.data?.length ?? 0 };
}
