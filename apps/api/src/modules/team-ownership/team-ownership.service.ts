import { AFC_TEAMS, CFB_27_TEAMS, CFB_TEAM_PRIMARY_COLORS, NFL_TEAM_PRIMARY_COLORS, NFC_TEAMS, type CfbTeamOption } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext, isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { trySeedDefaultScheduleAfterTeamsReady } from "../schedule/schedule.service.js";
import { syncScheduleGameUserIdsForLeague, syncScheduleGameUserIdsForTeams } from "../schedule/sync-game-user-ids.js";
import { clearRivalriesForCustomTeam, ensureLeagueRivalries } from "../rivalries/rivalries.service.js";
import { addMemberRole, ensureManagedRoleId, ensureManagedRolesPositioned, getGuildMemberDisplayNameMap, listGuildMembers, postDiscordChannelMessage, removeMemberRole, setGuildMemberNickname, type DiscordGuildMemberSummary } from "../../lib/discord-guild.js";
import { REC_MANAGED_ROLES, type RecManagedRoleKey } from "@rec/shared";
import { isHeadCommissionerAssignment, parseAssignmentAuthority, buildManagedTeamNickname, type AssignableRoleKey } from "./assignment-authority.js";
import type { CreateDefaultTeamsInput, CustomTeamReplacementInput, LinkUserToTeamInput, ResetDefaultTeamsInput, UnlinkAllTeamsInput, UnlinkTeamInput } from "./team-ownership.schemas.js";
import { releaseBacklogForLeague } from "../economy/economy-backlog.js";
import { formatTeamDisplayName, resolveTeamSchool } from "../users/user-profile-stats.service.js";

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

type DefaultTeamInsertRow = {
  league_id: string;
  name: string;
  abbreviation: string;
  conference: string | null;
  division: string | null;
  display_city: string | null;
  display_nick: string | null;
  display_abbr?: string | null;
  is_relocated?: boolean;
  original_abbreviation?: string | null;
  source: string;
  primary_color: string;
};

async function replaceLeagueDefaultTeamsAtomic(input: {
  leagueId: string;
  teams: DefaultTeamInsertRow[];
  blockIfRelocated: boolean;
}) {
  const result = await supabase.rpc("rec_replace_league_default_teams", {
    p_league_id: input.leagueId,
    // node-pg serializes JS arrays as Postgres arrays; stringify so the jsonb param receives JSON.
    p_teams: JSON.stringify(input.teams),
    p_block_if_relocated: input.blockIfRelocated,
  });
  if (result.error) {
    const message = String((result.error as { message?: string })?.message ?? result.error);
    if (message.includes("DEFAULT_TEAMS_BLOCKED_BY_RELOCATED")) {
      throw new ApiError(409, "Default teams cannot be reset after a custom replacement has been created in this league.");
    }
    throw new ApiError(500, "We couldn't replace the default league teams. Please try again.", result.error);
  }
  const payload = (result.data ?? null) as { teams?: unknown[]; teamCount?: number } | null;
  const teams = Array.isArray(payload?.teams) ? payload!.teams : [];
  if (!teams.length) {
    throw new ApiError(500, "We couldn't replace the default league teams. Please try again.", result.data);
  }
  return teams;
}

/** Clears roles/nickname managed by an ended team assignment, regardless of which surface
 * initiated the unlink. */
export async function clearDiscordTeamIdentityForUsers(input: { leagueId: string; guildId?: string | null; userIds: string[] }) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (!userIds.length) return { cleared: [] as string[], failed: [] as Array<{ userId: string; reason: string }> };
  let guildId = input.guildId ?? null;
  if (!guildId) {
    const link = await supabase.from("rec_server_league_links").select("server:rec_discord_servers(guild_id)")
      .eq("league_id", input.leagueId).eq("is_primary", true).maybeSingle();
    const server = Array.isArray(link.data?.server) ? link.data.server[0] : link.data?.server;
    guildId = server?.guild_id ?? null;
  }
  if (!guildId) return { cleared: [], failed: [] };
  const active = await supabase.from("rec_team_assignments").select("user_id").eq("league_id", input.leagueId)
    .eq("assignment_status", "active").is("ended_at", null).in("user_id", userIds);
  if (active.error) throw new ApiError(500, "We couldn't verify unlinked team assignments. Please try again.", active.error);
  const activeIds = new Set((active.data ?? []).map((row) => row.user_id));
  const targets = userIds.filter((userId) => !activeIds.has(userId));
  if (!targets.length) return { cleared: [], failed: [] };
  const accounts = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", targets);
  if (accounts.error) throw new ApiError(500, "We couldn't load Discord accounts for team cleanup. Please try again.", accounts.error);
  const roles = await Promise.all((['member', 'compCommittee', 'commissioner'] as const)
    .map(async (key) => await bestEffort("discord.ensure_managed_role", () => ensureManagedRoleId(guildId!, key), { guildId }) ?? null));
  const cleared: string[] = [];
  const failed: Array<{ userId: string; reason: string }> = [];
  for (const account of accounts.data ?? []) {
    try {
      for (const roleId of roles) if (roleId) await removeMemberRole(guildId, account.discord_id, roleId, "REC team unlinked - clearing managed role");
      await setGuildMemberNickname(guildId, account.discord_id, "", "REC team unlinked - clearing managed nickname");
      cleared.push(account.user_id);
    } catch (error) {
      failed.push({ userId: account.user_id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { cleared, failed };
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
    primary_color: isCfbGame
      ? (CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF")
      : (NFL_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF"),
  }));
  const result = await supabase.from("rec_teams").insert(rows).select("*");
  if (result.error) throw new ApiError(500, "We couldn't create the default league teams. Please try again.", result.error);
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
    primary_color: isCfb
      ? (CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF")
      : (NFL_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF")
  }));

  const teams = await replaceLeagueDefaultTeamsAtomic({
    leagueId: league.id,
    teams: rows,
    blockIfRelocated: false,
  });
  await ensureLeagueRivalries(league.id, league.game);
  syncRecruitingAd(league.id);

  await writeAuditLog({
    action: league.game === "cfb_27" ? "teams.default_cfb.upserted" : "teams.default_nfl.upserted",
    entityType: "rec_teams",
    newValue: { guildId: input.guildId, leagueId: league.id, game: league.game, teamCount: rows.length },
    reason: `${defaultTeamResetDescription(league.game)} created for Team Ownership setup.`,
    source: "manual_admin_entry"
  });

  const seedResult = await bestEffort("schedule.seed_after_teams_ready", () => trySeedDefaultScheduleAfterTeamsReady({
    guildId: input.guildId,
    requestedByDiscordId: input.requestedByDiscordId ?? null,
  }), { guildId: input.guildId, leagueId: league.id }) ?? null;

  return { league, teams, defaultScheduleSeed: seedResult };
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
    display_city: isCfb ? cfbDisplayCity(team as CfbTeamOption) : null,
    display_nick: isCfb ? (team as CfbTeamOption).mascot : null,
    display_abbr: null,
    is_relocated: false,
    original_abbreviation: null,
    source: "manual_admin_entry" as const,
    primary_color: isCfb
      ? (CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF")
      : (NFL_TEAM_PRIMARY_COLORS[team.abbreviation] ?? "#FFFFFF"),
  }));

  const teams = await replaceLeagueDefaultTeamsAtomic({
    leagueId: league.id,
    teams: rows,
    blockIfRelocated: true,
  });
  await ensureLeagueRivalries(league.id, league.game);
  syncRecruitingAd(league.id);

  await writeAuditLog({
    action: league.game === "cfb_27" ? "teams.default_cfb.reset" : "teams.default_nfl.reset",
    entityType: "rec_teams",
    newValue: { guildId: input.guildId, leagueId: league.id, game: league.game, teamCount: teams.length },
    reason: `${defaultTeamResetDescription(league.game)} reset through Team Management.`,
    source: "manual_admin_entry"
  });

  return { league, teams };
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

  if (existing.error) throw new ApiError(500, "We couldn't look up that team slot. Please try again.", existing.error);

  const liveTeams = existing.data ? { data: [], error: null } : await supabase
    .from("rec_teams")
    .select("*")
    .eq("league_id", league.id);
  if (liveTeams.error) throw new ApiError(500, "We couldn't load live league teams. Please try again.", liveTeams.error);

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

  if (result.error) throw new ApiError(500, "We couldn't register that custom team. Please try again.", result.error);
  await clearRivalriesForCustomTeam(league.id, result.data.id);
  const { refreshGameChannelIntrosForTeam } = await import("../game-channels/game-channels.service.js");
  await refreshGameChannelIntrosForTeam(input.guildId, result.data.id).catch((error) => {
    console.error("[ERROR] Failed to refresh game-channel embeds after custom team replacement (non-fatal):", error);
  });

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

  if (linkedResult.error) throw new ApiError(500, "We couldn't load linked users for that custom team. Please try again.", linkedResult.error);

  const linkedUserIds = [...new Set((linkedResult.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = linkedUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", linkedUserIds)
    : { data: [], error: null };

  if (accounts.error) throw new ApiError(500, "We couldn't load linked Discord accounts for that custom team. Please try again.", accounts.error);

  const discordByUserId = new Map((accounts.data ?? []).map((account) => [account.user_id, account.discord_id]));
  const linkedUsers = (linkedResult.data ?? []).map((row: any) => {
    const roleKey = parseAssignmentAuthority(row.notes);
    const authority = roleKey === "compCommittee" ? "co_commissioner" : roleKey;
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

  if (account.error) throw new ApiError(500, "We couldn't check that Discord account. Please try again.", account.error);

  let userId = account.data?.user_id;

  // site:{recUserId} is a synthetic discord id for site-only members. Always resolve to that
  // embedded user — never mint a blank ghost rec_users row the way a missing real Discord
  // snowflake would. Completing a Discord-guild team request for a site requester used to
  // create an empty-named assignment that blocked open teams while the real profile stayed unlinked.
  if (isSiteOnlyDiscordId(input.discordId)) {
    const siteUserId = recUserIdFromSiteOnlyDiscordId(input.discordId);
    const siteUser = await supabase.from("rec_users").select("id,display_name,username").eq("id", siteUserId).maybeSingle();
    if (siteUser.error) throw new ApiError(500, "We couldn't load that REC account. Please try again.", siteUser.error);
    if (!siteUser.data) throw new ApiError(404, "That site account was not found.");
    userId = siteUser.data.id;

    if (account.data?.user_id && account.data.user_id !== siteUserId) {
      // Heal a prior ghost mapping so future lookups hit the real user.
      const healed = await supabase
        .from("rec_discord_accounts")
        .update({
          user_id: siteUserId,
          username: siteUser.data.username ?? siteUser.data.display_name ?? null,
          global_name: siteUser.data.display_name ?? siteUser.data.username ?? null,
        })
        .eq("discord_id", input.discordId);
      if (healed.error) throw new ApiError(500, "We couldn't repair that site account link. Please try again.", healed.error);
    } else if (!account.data) {
      const created = await supabase
        .from("rec_discord_accounts")
        .insert({
          user_id: siteUserId,
          discord_id: input.discordId,
          username: siteUser.data.username ?? siteUser.data.display_name ?? null,
          global_name: siteUser.data.display_name ?? siteUser.data.username ?? null,
        })
        .select("user_id")
        .single();
      if (created.error) throw new ApiError(500, "We couldn't link that site account. Please try again.", created.error);
    }
  } else if (!userId) {
    // Look up the real Discord nickname/username instead of stashing the raw snowflake as
    // a placeholder — that placeholder was never getting corrected later, so it just showed
    // up permanently as a number in every team/roster/chat display. Leave the name columns
    // null on a failed/missed lookup rather than falling back to the raw ID; a later login
    // or hub read can still resolve a real name, but a written snowflake never self-heals.
    const liveName = await bestEffort("discord.member_display_name", () => getGuildMemberDisplayNameMap(input.guildId).then((names) => names.get(input.discordId) ?? null), { guildId: input.guildId }) ?? null;

    // display_name is NOT NULL — "" (its own column default) stands in for a failed/missed
    // lookup rather than null, which would fail the insert outright.
    const user = await supabase
      .from("rec_users")
      .insert({ display_name: liveName ?? "", status: "active" })
      .select("id")
      .single();

    if (user.error) throw new ApiError(500, "We couldn't create a REC user for that Discord account. Please try again.", user.error);

    const created = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: user.data.id, discord_id: input.discordId, username: liveName, global_name: liveName })
      .select("user_id")
      .single();

    if (created.error) {
      // Roll back the just-created rec_users row rather than leaving it orphaned — with no
      // rec_discord_accounts row it can never self-heal its blank display_name later, and it
      // has no team/league attachment either, so it just sits as a permanent nameless ghost.
      await supabase.from("rec_users").delete().eq("id", user.data.id);
      throw new ApiError(500, "We couldn't link that Discord account. Please try again.", created.error);
    }
    userId = created.data.user_id;
  }

  const linkedUser = await supabase
    .from("rec_users")
    .select("id,supabase_auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (linkedUser.error) throw new ApiError(500, "We couldn't load that linked user. Please try again.", linkedUser.error);

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

  // Capture teams this user (or the prior coach of this slot) is leaving so schedule
  // home_user_id/away_user_id can be cleared/rewritten for those matchups too.
  let scheduleTeamIds: string[];
  try {
    const priorAssignments = await supabase
      .from("rec_team_assignments")
      .select("team_id")
      .eq("league_id", league.id)
      .is("ended_at", null)
      .or(`user_id.eq.${userId},and(team_id.eq.${input.teamId},assignment_status.eq.active)`);
    if (priorAssignments.error) throw priorAssignments.error;
    scheduleTeamIds = [...new Set([...(priorAssignments.data ?? []).map((row) => row.team_id), input.teamId].filter(Boolean))];
  } catch (queryErr) {
    console.error("[TEAM-LINK] priorAssignments .or() query failed, retrying without user filter:", queryErr);
    const fallback = await supabase
      .from("rec_team_assignments")
      .select("team_id")
      .eq("league_id", league.id)
      .eq("team_id", input.teamId)
      .is("ended_at", null);
    if (fallback.error) throw new ApiError(500, "We couldn't check existing team assignments. Please try again.", fallback.error);
    scheduleTeamIds = [...new Set([...(fallback.data ?? []).map((row) => row.team_id), input.teamId].filter(Boolean))];
  }

  await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "replaced", ended_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .is("ended_at", null);

  // A team can only have one current coach. Previously we only ended this user's old
  // assignment, allowing a second user to be inserted for an already-owned team.
  await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "replaced", ended_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .eq("team_id", input.teamId)
    .eq("assignment_status", "active")
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

  if (assignment.error) throw new ApiError(500, "We couldn't create that team assignment. Please try again.", assignment.error);

  await syncScheduleGameUserIdsForTeams(league.id, scheduleTeamIds);

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

  // Best-effort: legitimately no-ops if the member hasn't actually joined this Discord server
  // yet (e.g. they were just approved and haven't clicked their invite link) —
  // bot/index-timeout.ts's guildMemberAdd handler catches that case up once they do join. Any
  // other failure (role hierarchy, missing MANAGE_NICKNAMES, etc.) is logged rather than
  // silently eaten, since that used to leave "nicknames just don't work" undebuggable.
  await setGuildMemberNickname(
    input.guildId,
    input.discordId,
    shortTeamNickname(team.data, league.game === "cfb_27"),
    "REC team linked — nickname set to team",
  ).catch((error) => console.error(`[WARN] Failed to set nickname for ${input.discordId} in guild ${input.guildId} (non-fatal):`, error));

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

  const { syncAvailabilityBoard } = await import("../scheduling/availability-board.service.js");
  syncAvailabilityBoard(input.guildId).catch((error) => console.error("[ERROR] Failed to resync availability board after team link (non-fatal):", error));

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
  if (account.error) throw new ApiError(500, "We couldn't load your Discord account. Please try again.", account.error);
  if (!account.data?.user_id) return { synced: false };

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team:rec_teams(name,display_nick,is_relocated)")
    .eq("league_id", league.id)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load your team assignment. Please try again.", assignment.error);
  const team = assignment.data?.team as { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null } | null;
  if (!team) return { synced: false };

  const memberRoleId = await ensureManagedRoleId(guildId, "member");
  await addMemberRole(guildId, discordId, memberRoleId, "REC team linked; default Member role (caught up on guild join)")
    .catch((error) => console.error(`[WARN] Failed to add Member role for ${discordId} in guild ${guildId} (non-fatal):`, error));
  await setGuildMemberNickname(guildId, discordId, shortTeamNickname(team, league.game === "cfb_27"), "REC team linked — nickname set to team (caught up on guild join)")
    .catch((error) => console.error(`[WARN] Failed to set nickname for ${discordId} in guild ${guildId} (non-fatal):`, error));
  return { synced: true };
}

function isRealDiscordSnowflake(discordId: string | null | undefined): boolean {
  const value = String(discordId ?? "");
  return /^\d{5,}$/.test(value) && !isSiteOnlyDiscordId(value);
}

function managedRoleKeysForAuthority(authority: string | null | undefined): AssignableRoleKey[] {
  const key = parseAssignmentAuthority(authority);
  if (key === "commissioner") return ["member", "compCommittee", "commissioner"];
  if (key === "compCommittee") return ["member", "compCommittee"];
  return ["member"];
}

/**
 * After a Discord snowflake swap (My Account replace, unlink, or commissioner relink),
 * strip REC managed roles/nickname from the old id and apply the current team assignment
 * to the new id across every linked league server.
 */
export async function resyncDiscordGuildIdentityAfterTransfer(input: {
  userId: string;
  fromDiscordId: string;
  toDiscordId: string;
}): Promise<{ guilds: number }> {
  const fromReal = isRealDiscordSnowflake(input.fromDiscordId);
  const toReal = isRealDiscordSnowflake(input.toDiscordId);
  if (!fromReal && !toReal) return { guilds: 0 };

  const assignments = await supabase
    .from("rec_team_assignments")
    .select("league_id,notes,team:rec_teams(name,display_nick,is_relocated)")
    .eq("user_id", input.userId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) {
    throw new ApiError(500, "We couldn't load team assignments for Discord role sync. Please try again.", assignments.error);
  }
  const rows = assignments.data ?? [];
  if (!rows.length) return { guilds: 0 };

  const leagueIds = [...new Set(rows.map((row) => row.league_id).filter(Boolean))];
  const [links, leagues] = await Promise.all([
    supabase.from("rec_server_league_links").select("league_id,server:rec_discord_servers(guild_id)").in("league_id", leagueIds).eq("is_primary", true),
    supabase.from("rec_leagues").select("id,game").in("id", leagueIds),
  ]);
  if (links.error) throw new ApiError(500, "We couldn't load league Discord servers for role sync. Please try again.", links.error);
  if (leagues.error) throw new ApiError(500, "We couldn't load leagues for Discord role sync. Please try again.", leagues.error);

  const guildByLeague = new Map<string, string>();
  for (const link of links.data ?? []) {
    const server = Array.isArray((link as any).server) ? (link as any).server[0] : (link as any).server;
    const guildId = server?.guild_id ? String(server.guild_id) : "";
    if (guildId) guildByLeague.set(String(link.league_id), guildId);
  }
  const gameByLeague = new Map((leagues.data ?? []).map((row) => [row.id, String(row.game ?? "")]));

  const byGuild = new Map<string, { authority: string; team: { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null }; isCfb: boolean }>();
  for (const row of rows) {
    const guildId = guildByLeague.get(row.league_id);
    if (!guildId) continue;
    const team = row.team as { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null } | null;
    if (!team) continue;
    byGuild.set(guildId, {
      authority: String(row.notes ?? ""),
      team,
      isCfb: gameByLeague.get(row.league_id) === "cfb_27",
    });
  }

  for (const [guildId, spec] of byGuild) {
    const roleIds = await Promise.all(
      (["member", "compCommittee", "commissioner", "discordOnly"] as const).map(async (key) => {
        const roleId = await bestEffort("discord.ensure_managed_role", () => ensureManagedRoleId(guildId, key), { guildId });
        return [key, roleId] as const;
      }),
    );
    const roleIdByKey = new Map(roleIds);
    if (fromReal) {
      for (const [, roleId] of roleIdByKey) {
        if (!roleId) continue;
        await removeMemberRole(guildId, input.fromDiscordId, roleId, "REC Discord account replaced — clearing managed role on previous account")
          .catch((error) => console.error(`[WARN] Failed to clear managed role on previous Discord ${input.fromDiscordId} in ${guildId} (non-fatal):`, error));
      }
      await setGuildMemberNickname(guildId, input.fromDiscordId, "", "REC Discord account replaced — clearing nickname on previous account")
        .catch((error) => console.error(`[WARN] Failed to clear nickname on previous Discord ${input.fromDiscordId} in ${guildId} (non-fatal):`, error));
    }
    if (toReal) {
      for (const key of managedRoleKeysForAuthority(spec.authority)) {
        const roleId = roleIdByKey.get(key);
        if (!roleId) continue;
        await addMemberRole(guildId, input.toDiscordId, roleId, "REC Discord account replaced — applying current team role")
          .catch((error) => console.error(`[WARN] Failed to add managed role on new Discord ${input.toDiscordId} in ${guildId} (non-fatal):`, error));
      }
      await setGuildMemberNickname(
        guildId,
        input.toDiscordId,
        buildManagedTeamNickname(shortTeamNickname(spec.team, spec.isCfb), spec.authority),
        "REC Discord account replaced — nickname set to current team",
      ).catch((error) => console.error(`[WARN] Failed to set nickname on new Discord ${input.toDiscordId} in ${guildId} (non-fatal):`, error));
    }
  }
  return { guilds: byGuild.size };
}

/** Retroactive bulk fix — every currently-linked member's nickname gets force-set to their
 * team name plus the Co-Commish/Commissioner suffix the bot uses on link. Failures here are
 * reported per-user instead of swallowed, since "the bot isn't touching nicknames at all" needs a real reason (most likely:
 * the bot's own role sits below the target member's highest role in the server's role list —
 * Discord blocks nickname/role changes on anyone positioned at or above the acting bot
 * regardless of the bot having Administrator, and never allows renaming the server owner at
 * all — but a wrong/missing MANAGE_NICKNAMES grant or a stale/left member could also explain it). */
export async function resyncTeamNicknamesForGuild(guildId: string): Promise<{
  synced: Array<{ discordId: string; nickname: string }>;
  failed: Array<{ discordId: string; nickname: string; reason: string }>;
  skipped: Array<{ discordId: string; reason: string }>;
}> {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const isCfb = league.game === "cfb_27";
  const ownerUserId = typeof league.owner_user_id === "string" ? league.owner_user_id : null;
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,notes,team:rec_teams(name,display_nick,is_relocated)")
    .eq("league_id", league.id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "We couldn't load team assignments right now. Please try again.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [] as any[], error: null };
  if (accounts.error) throw new ApiError(500, "We couldn't load linked Discord accounts right now. Please try again.", accounts.error);
  const discordIdByUser = new Map<string, string>((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  const synced: Array<{ discordId: string; nickname: string }> = [];
  const failed: Array<{ discordId: string; nickname: string; reason: string }> = [];
  const skipped: Array<{ discordId: string; reason: string }> = [];

  // Discord's member-nickname PATCH bucket is shared across the guild — five concurrent
  // patches stampede it and the rest of the league 429s. One at a time, with discordBotFetch
  // retrying 429s, is slower but actually completes. Head commissioner is skipped: Discord
  // never lets a bot rename the guild owner, and the commish role usually sits at/above the bot.
  await mapWithConcurrency(assignments.data ?? [], 1, async (row: any) => {
    const discordId = discordIdByUser.get(row.user_id);
    if (!discordId) { skipped.push({ discordId: String(row.user_id), reason: "No linked Discord account." }); return; }
    if (isHeadCommissionerAssignment({ notes: row.notes, userId: row.user_id, ownerUserId })) {
      skipped.push({ discordId, reason: "Head commissioner — Discord does not let the bot change this nickname." });
      return;
    }
    const team = row.team as { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null } | null;
    if (!team) { skipped.push({ discordId, reason: "No team on this assignment." }); return; }
    const nickname = buildManagedTeamNickname(shortTeamNickname(team, isCfb), row.notes);
    try {
      await setGuildMemberNickname(guildId, discordId, nickname, "REC nickname resync (retroactive)");
      synced.push({ discordId, nickname });
    } catch (error) {
      failed.push({ discordId, nickname, reason: error instanceof Error ? error.message : String(error) });
    }
  });

  return { synced, failed, skipped };
}

/** Bulk fix for a Discord server that previously hosted a different REC league (or whose
 * roles just drifted from reality over time): every guild member currently holding a REC
 * managed role gets reconciled against this league's real active team assignments — wrong or
 * stale commissioner/comp-committee/member roles from a prior season or a prior league on
 * this same server are stripped, and the correct role for their current assignment (if any)
 * is (re)applied. Also pushes the bot's own managed roles as high in the hierarchy as it can
 * (see ensureManagedRolesPositioned) since a reused server commonly has the bot's role sitting
 * wherever a previous setup left it. */
export async function reconcileGuildRolesForGuild(guildId: string): Promise<{
  corrected: Array<{ discordId: string; from: string[]; to: string | null }>;
  alreadyCorrect: number;
  failed: Array<{ discordId: string; reason: string }>;
}> {
  const { league } = await getCurrentLeagueForGuild(guildId);
  await bestEffort("discord.ensure_managed_roles_positioned", () => ensureManagedRolesPositioned(guildId), { guildId });

  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,notes")
    .eq("league_id", league.id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "We couldn't load team assignments right now. Please try again.", assignments.error);

  const userIds = [...new Set((assignments.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds)
    : { data: [] as any[], error: null };
  if (accounts.error) throw new ApiError(500, "We couldn't load linked Discord accounts right now. Please try again.", accounts.error);
  const discordIdByUser = new Map<string, string>((accounts.data ?? []).map((row: any) => [row.user_id, row.discord_id]));

  const expectedRoleKeyByDiscordId = new Map<string, AssignableRoleKey>();
  for (const row of assignments.data ?? []) {
    const discordId = discordIdByUser.get(row.user_id);
    if (!discordId) continue;
    expectedRoleKeyByDiscordId.set(discordId, parseAssignmentAuthority(row.notes));
  }

  const [members, roleIdByKeyEntries] = await Promise.all([
    listGuildMembers(guildId),
    Promise.all((["member", "compCommittee", "commissioner"] as const).map(async (key) => [key, await ensureManagedRoleId(guildId, key)] as const)),
  ]);
  const roleIdByKey = new Map(roleIdByKeyEntries);

  const corrected: Array<{ discordId: string; from: string[]; to: string | null }> = [];
  const failed: Array<{ discordId: string; reason: string }> = [];
  let alreadyCorrect = 0;

  // Same fully-serial-loop issue as resyncTeamNicknamesForGuild above: bound the concurrency
  // instead of doing every member's Discord role calls one at a time.
  await mapWithConcurrency(members, 5, async (member) => {
    if (member.isBot) return;
    const expectedKey = expectedRoleKeyByDiscordId.get(member.discordId) ?? null;
    const heldKey = member.managedRole === "discordOnly" ? null : member.managedRole;
    if (heldKey === expectedKey) { if (heldKey) alreadyCorrect += 1; return; }
    try {
      const rolesToStrip = (["member", "compCommittee", "commissioner"] as const).filter((key) => key !== expectedKey && key === heldKey);
      for (const key of rolesToStrip) {
        const roleId = roleIdByKey.get(key);
        if (roleId) await removeMemberRole(guildId, member.discordId, roleId, "REC role reconcile — stale/incorrect authority role");
      }
      if (!expectedKey && heldKey) {
        await setGuildMemberNickname(guildId, member.discordId, "", "REC role reconcile - clearing stale team nickname");
      }
      if (expectedKey) {
        const roleId = roleIdByKey.get(expectedKey);
        if (roleId) await addMemberRole(guildId, member.discordId, roleId, "REC role reconcile — corrected to current team assignment");
      }
      corrected.push({ discordId: member.discordId, from: heldKey ? [REC_MANAGED_ROLES[heldKey].name] : [], to: expectedKey ? REC_MANAGED_ROLES[expectedKey].name : null });
    } catch (error) {
      failed.push({ discordId: member.discordId, reason: error instanceof Error ? error.message : String(error) });
    }
  });

  return { corrected, alreadyCorrect, failed };
}

/** Strips every REC managed role (Commissioner/Co-Commish/Member/Discord Only) from every
 * member of a guild — used when a league is deleted so the next league to use this Discord
 * server (or the current one, if it's ever recreated) doesn't inherit a member's leftover
 * role from a league that no longer exists. Best-effort: a role grant/removal failing for one
 * member should never block the rest of the cleanup or the league deletion itself. */
export async function stripAllManagedRolesForGuild(guildId: string): Promise<{ clearedMembers: number; failed: Array<{ discordId: string; reason: string }> }> {
  const [members, roleEntries] = await Promise.all([
    listGuildMembers(guildId).catch(() => [] as DiscordGuildMemberSummary[]),
    Promise.all((["member", "compCommittee", "commissioner", "discordOnly"] as const).map(async (key) => [key, await bestEffort("discord.ensure_managed_role", () => ensureManagedRoleId(guildId, key), { guildId }) ?? null] as const)),
  ]);
  const failed: Array<{ discordId: string; reason: string }> = [];
  let clearedMembers = 0;

  for (const member of members) {
    if (member.isBot || !member.managedRole) continue;
    try {
      for (const [key, id] of roleEntries) {
        if (!id) continue;
        if (member.managedRole === key) await removeMemberRole(guildId, member.discordId, id, "REC league deleted — clearing managed roles");
      }
      clearedMembers += 1;
    } catch (error) {
      failed.push({ discordId: member.discordId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { clearedMembers, failed };
}

export async function listLinkedUsersTeams(guildId: string) {
  const { league } = await getCurrentLeagueForGuild(guildId);
  const result = await supabase
    .from("rec_team_assignments")
    .select("id,assignment_status,notes,user_id,team:rec_teams(id,name,abbreviation,conference,division),user:rec_users(id,display_name,supabase_auth_user_id),created_at")
    .eq("league_id", league.id)
    .is("ended_at", null)
    .order("created_at", { ascending: false });

  if (result.error) throw new ApiError(500, "We couldn't load linked users and teams. Please try again.", result.error);

  const userIds = [...new Set((result.data ?? []).map((row) => row.user_id).filter(Boolean))];
  const accounts = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds)
    : { data: [], error: null };

  if (accounts.error) throw new ApiError(500, "We couldn't load linked Discord accounts right now. Please try again.", accounts.error);

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
  if (teams.error || assignments.error) throw new ApiError(500, "We couldn't load the team linking overview. Please try again.", teams.error ?? assignments.error);
  const userIds = [...new Set((assignments.data ?? []).map((row) => row.user_id))];
  const accounts = userIds.length ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds) : { data: [], error: null };
  if (accounts.error) throw new ApiError(500, "We couldn't load linked Discord accounts right now. Please try again.", accounts.error);
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
  if (teams.error) throw new ApiError(500, "We couldn't load league teams right now. Please try again.", teams.error);

  const [assignments, pendingRequests] = await Promise.all([
    // Only real active coaches occupy a team. ended_at-null rows with a null/ghost user_id
    // (or non-active status) must not hide the team from /openteams or the recruiting board.
    supabase.from("rec_team_assignments").select("team_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null).not("user_id", "is", null),
    // A team with a pending (unapproved) request shouldn't show as open — otherwise a second
    // member could request the same team while the first request is still awaiting the
    // commissioner. Only "pending"/"approved" hold the team; "rejected"/"completed" don't
    // (completed teams are already caught by the assignment it created).
    supabase.from("rec_team_link_requests").select("team_id").eq("league_id", leagueId).in("status", ["pending", "approved"]),
  ]);
  if (assignments.error) throw new ApiError(500, "We couldn't load team assignments right now. Please try again.", assignments.error);
  if (pendingRequests.error) throw new ApiError(500, "We couldn't load pending team requests. Please try again.", pendingRequests.error);

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

  if (result.error) throw new ApiError(500, "We couldn't unlink that team assignment. Please try again.", result.error);
  await syncScheduleGameUserIdsForTeams(league.id, [input.teamId]);
  const cleanup = await clearDiscordTeamIdentityForUsers({ leagueId: league.id, guildId: input.guildId, userIds: (result.data ?? []).map((row) => row.user_id).filter(Boolean) });

  await writeAuditLog({
    action: "teams.unlinked",
    entityType: "rec_team_assignments",
    newValue: { guildId: input.guildId, leagueId: league.id, teamId: input.teamId, unlinkCount: result.data?.length ?? 0 },
    reason: "Single team assignment unlinked through Team Ownership admin command.",
    source: "manual_admin_entry"
  });
  syncRecruitingAd(league.id);

  const { syncAvailabilityBoard: syncAvailabilityBoard1 } = await import("../scheduling/availability-board.service.js");
  syncAvailabilityBoard1(input.guildId).catch((error) => console.error("[ERROR] Failed to resync availability board after team unlink (non-fatal):", error));

  return { league, unlinkedCount: result.data?.length ?? 0, discordCleanup: cleanup };
}

export async function unlinkAllTeamsForGuild(input: UnlinkAllTeamsInput) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);

  const result = await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "unlinked", ended_at: new Date().toISOString() })
    .eq("league_id", league.id)
    .is("ended_at", null)
    .select("*");

  if (result.error) throw new ApiError(500, "We couldn't unlink those team assignments. Please try again.", result.error);
  await syncScheduleGameUserIdsForLeague(league.id);
  const cleanup = await clearDiscordTeamIdentityForUsers({ leagueId: league.id, guildId: input.guildId, userIds: (result.data ?? []).map((row) => row.user_id).filter(Boolean) });

  await writeAuditLog({
    action: "teams.all_unlinked",
    entityType: "rec_team_assignments",
    newValue: { guildId: input.guildId, leagueId: league.id, unlinkCount: result.data?.length ?? 0 },
    reason: "All team assignments unlinked through Team Ownership admin command.",
    source: "manual_admin_entry"
  });
  syncRecruitingAd(league.id);

  const { syncAvailabilityBoard: syncAvailabilityBoard2 } = await import("../scheduling/availability-board.service.js");
  syncAvailabilityBoard2(input.guildId).catch((error) => console.error("[ERROR] Failed to resync availability board after team unlink-all (non-fatal):", error));

  return { league, unlinkedCount: result.data?.length ?? 0, discordCleanup: cleanup };
}

/** Releases every team link a member holds in the league(s) linked to a guild when they leave
 * the Discord server (guildMemberRemove). Without this, their active rec_team_assignments row
 * lingers with ended_at null forever, so rec_roster_league_conferences keeps striking the team
 * through in /openteams even though the member is gone. Also rejects the member's not-yet-
 * completed pending/approved team-link requests so those teams free up too. */
export async function releaseMemberTeamLinksOnLeave(input: { guildId: string; discordId: string }) {
  const { league } = await getCurrentLeagueForGuild(input.guildId);

  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to look up the leaving member's account.", account.error);

  let userId = account.data?.user_id ?? null;
  if (!userId && isSiteOnlyDiscordId(input.discordId)) {
    const siteUserId = recUserIdFromSiteOnlyDiscordId(input.discordId);
    const siteUser = await supabase.from("rec_users").select("id").eq("id", siteUserId).maybeSingle();
    if (siteUser.data?.id) userId = siteUser.data.id;
  }
  if (!userId) return { releasedAssignments: 0, rejectedRequests: 0, userId: null };

  const nowIso = new Date().toISOString();
  const ended = await supabase
    .from("rec_team_assignments")
    .update({ assignment_status: "unlinked", ended_at: nowIso, updated_at: nowIso })
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .is("ended_at", null)
    .select("team_id");
  if (ended.error) throw new ApiError(500, "Failed to release the leaving member's team assignments.", ended.error);
  if (ended.data?.length) {
    const teamIds = ended.data.map((row) => row.team_id).filter(Boolean);
    await syncScheduleGameUserIdsForTeams(league.id, teamIds);
    await announceMemberTeamDeparture({ guildId: input.guildId, discordId: input.discordId, teamIds }).catch((error) =>
      console.error("[WARN] Failed to post team-departure announcement (non-fatal):", error));
  }

  // Reject any pending/approved requests this member still has — same team-freeing effect, and
  // prevents an orphaned "approved" request from forever hiding the team (the state that caused
  // the original Commanders incident).
  const rejected = await supabase
    .from("rec_team_link_requests")
    .update({
      status: "rejected",
      resolved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("league_id", league.id)
    .eq("requester_user_id", userId)
    .in("status", ["pending", "approved"])
    .select("id");
  if (rejected.error) throw new ApiError(500, "Failed to close the leaving member's pending team requests.", rejected.error);

  if (ended.data?.length || rejected.data?.length) {
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "denied", reviewed_at: nowIso })
      .eq("league_id", league.id)
      .eq("requester_user_id", userId)
      .eq("status", "pending")
      .in("source_table", ["rec_team_link_requests"]);
  }

  if (ended.data?.length) syncRecruitingAd(league.id);

  if (ended.data?.length || rejected.data?.length) {
    await writeAuditLog({
      action: "team_links.released_on_member_leave",
      entityType: "rec_league_memberships",
      entityId: league.id,
      newValue: {
        guildId: input.guildId,
        leagueId: league.id,
        discordId: input.discordId,
        releasedAssignments: ended.data?.length ?? 0,
        rejectedRequests: rejected.data?.length ?? 0,
      },
      reason: `Member left Discord server ${input.guildId}`,
      source: "manual_admin_entry",
    });
  }

  return {
    releasedAssignments: ended.data?.length ?? 0,
    rejectedRequests: rejected.data?.length ?? 0,
    userId,
    teamIds: (ended.data ?? []).map((row) => row.team_id),
  };
}

// Cheeky legal-themed charges for the public departure announcement below — purely flavor text,
// picked at random so repeat departures don't read as a copy-pasted template.
const DEPARTURE_TORTS = [
  "Abandonment", "Negligence", "Breach of Fiduciary Duty", "Constructive Desertion",
  "Reckless Disregard for the Standings", "Intentional Infliction of Roster Distress",
  "Failure to Mitigate Losses", "Unjust Enrichment (of everyone else's schedule)",
];

/** Public "Coach quits the team" announcement for a member who left the Discord server while
 * still holding an active team assignment. Best-effort and non-fatal — a missing announcements
 * channel or a Discord API hiccup shouldn't block the team-release cleanup above. */
async function announceMemberTeamDeparture(input: { guildId: string; discordId: string; teamIds: string[] }) {
  if (!input.teamIds.length) return;
  const context = await getCurrentLeagueContext(input.guildId);
  const channelId = String((context?.routes as any)?.announcements_channel_id ?? "");
  if (!channelId) return;

  const teams = await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated").in("id", input.teamIds);
  if (teams.error || !teams.data?.length) return;
  const teamNames = teams.data.map((team) => formatTeamDisplayName(team) ?? team.name).filter(Boolean);
  if (!teamNames.length) return;

  const tort = DEPARTURE_TORTS[Math.floor(Math.random() * DEPARTURE_TORTS.length)];
  const teamList = teamNames.join(", ");
  const content = [
    "@everyone",
    `🚨 <@${input.discordId}> has left the server, leaving the **${teamList}** without a coach.`,
    `Charged with: **${tort}** (a tort, probably).`,
    "Nah nah nah, nah nah nah nah, hey hey hey, goodbyeee 👋",
  ].join("\n");

  await postDiscordChannelMessage(channelId, { content, allowed_mentions: { parse: ["everyone"] } });
}
