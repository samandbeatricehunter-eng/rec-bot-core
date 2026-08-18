import { REC_ROUTE_CHANNELS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { listInstallableDiscordGuilds } from "../../lib/discord-oauth.js";
import { addMemberRole, ensureManagedRoleId, ensureManagedRolesPositioned, isBotInGuild, setGuildMemberNickname } from "../../lib/discord-guild.js";
import { supabase } from "../../lib/supabase.js";
import { registerServer } from "../setup/setup.service.js";
import { syncBoxScoreCommandForLeague } from "../league-week/data-mode.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { assertLeagueNotFrozen } from "./entitlements.service.js";

/**
 * Creates or promotes the primary league link between a registered Discord server and a league.
 */
async function ensurePrimaryServerLeagueLink(serverId: string, leagueId: string) {
  const existingPrimary = await supabase
    .from("rec_server_league_links")
    .select("id,league_id,is_primary")
    .eq("server_id", serverId)
    .eq("is_primary", true)
    .maybeSingle();

  if (existingPrimary.error) {
    throw new ApiError(500, "Failed to look up existing primary league link.", existingPrimary.error);
  }

  if (existingPrimary.data?.league_id && existingPrimary.data.league_id !== leagueId) {
    throw new ApiError(
      409,
      "This Discord server is already linked to a different primary league. Unlink or delete that league before claiming another.",
    );
  }

  const existingSame = await supabase
    .from("rec_server_league_links")
    .select("id,league_id,is_primary")
    .eq("server_id", serverId)
    .eq("league_id", leagueId)
    .maybeSingle();

  if (existingSame.error) {
    throw new ApiError(500, "Failed to look up server-league link.", existingSame.error);
  }

  let link = existingSame.data;
  if (link) {
    if (!link.is_primary) {
      const updated = await supabase
        .from("rec_server_league_links")
        .update({ is_primary: true })
        .eq("id", link.id)
        .select("*")
        .single();
      if (updated.error) throw new ApiError(500, "Failed to mark league link as primary.", updated.error);
      link = updated.data;
    }
  } else {
    const inserted = await supabase
      .from("rec_server_league_links")
      .insert({
        server_id: serverId,
        league_id: leagueId,
        is_primary: true,
      })
      .select("*")
      .single();
    if (inserted.error) throw new ApiError(500, "Failed to link league to server.", inserted.error);
    link = inserted.data;
  }

  return link;
}

export type LinkSiteLeagueToServerInput = {
  leagueId: string;
  requestedByUserId: string;
  providerToken: string;
  guildId: string;
  serverName?: string;
};

/**
 * Directly links a league to a Discord server from the site — no invite token or /claim-league
 * round-trip. The caller is verified as the league creator, and the chosen guild is confirmed
 * against a fresh "guilds"-scoped OAuth token (owner or Administrator/Manage Server) before the
 * server + primary link are created. Returns the league-scoped invite URL so the user can then
 * add the bot to that server.
 */
export async function linkSiteLeagueToServer(input: LinkSiteLeagueToServerInput) {
  if (!input.guildId?.trim()) throw new ApiError(400, "guildId is required.");
  if (!input.providerToken?.trim()) throw new ApiError(400, "A fresh Discord permission grant is required.");

  const league = await supabase
    .from("rec_leagues")
    .select("id,owner_user_id,discord_bot_enabled")
    .eq("id", input.leagueId)
    .maybeSingle();
  if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
  if (!league.data) throw new ApiError(404, "League not found.");
  if (league.data.owner_user_id !== input.requestedByUserId) {
    throw new ApiError(403, "Only the league creator can link a Discord server.");
  }
  await assertLeagueNotFrozen(league.data.id);

  const installable = await listInstallableDiscordGuilds(input.providerToken);
  const guild = installable.find((g) => g.id === input.guildId);
  if (!guild) {
    throw new ApiError(403, "You must own or manage the selected Discord server.");
  }

  const serverResult = await registerServer({
    guildId: input.guildId,
    name: input.serverName?.trim() || guild.name,
    setupMode: "manual_first",
  });

  const link = await ensurePrimaryServerLeagueLink(serverResult.server.id, league.data.id);

  if (!league.data.discord_bot_enabled) {
    await supabase
      .from("rec_leagues")
      .update({ discord_bot_enabled: true, updated_at: new Date().toISOString() })
      .eq("id", league.data.id);
  }

  await syncBoxScoreCommandForLeague(input.guildId, league.data.id);

  return {
    linked: true as const,
    server: { id: serverResult.server.id, name: serverResult.server.name },
    serverLeagueLink: link,
  };
}

export type LinkUnclaimedLeagueByDiscordInput = {
  discordId: string;
  guildId: string;
  serverName?: string;
  leagueId?: string;
};

export type LinkUnclaimedLeagueByDiscordResult =
  | { linked: true; server: { id: string; name: string }; leagueName: string }
  | { linked: false; needsSelection: true; leagues: Array<{ id: string; name: string }> };

/**
 * Simpler alternative to linkSiteLeagueToServer's popup/OAuth-token round-trip: a commissioner
 * with Manage Server permission runs a slash command inside the target guild. Discord's own
 * membership/permission check on the interaction IS the guild-ownership verification here — no
 * provider token, no cross-window postMessage, no session-storage race. Only ever claims a
 * league the caller actually owns and that has no Discord server yet (discord_bot_enabled false
 * — see the "unclaimed league" comment on registerServer's caller above), so it can't be used to
 * hijack someone else's league or re-link an already-claimed one.
 */
export async function linkUnclaimedLeagueByDiscord(input: LinkUnclaimedLeagueByDiscordInput): Promise<LinkUnclaimedLeagueByDiscordResult> {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to resolve your REC account.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "Link your Discord account to REC on the site first, then try again.");

  let unclaimedQuery = supabase
    .from("rec_leagues")
    .select("id,name")
    .eq("owner_user_id", account.data.user_id)
    .eq("discord_bot_enabled", false);
  if (input.leagueId) unclaimedQuery = unclaimedQuery.eq("id", input.leagueId);
  const unclaimed = await unclaimedQuery;
  if (unclaimed.error) throw new ApiError(500, "Failed to look up your leagues.", unclaimed.error);

  const leagues = unclaimed.data ?? [];
  if (!leagues.length) {
    throw new ApiError(404, input.leagueId ? "That league isn't yours to link, or it's already linked." : "You don't have any unclaimed leagues to link — create one on the site first.");
  }
  if (leagues.length > 1) {
    return { linked: false, needsSelection: true, leagues };
  }

  const league = leagues[0]!;
  const serverResult = await registerServer({
    guildId: input.guildId,
    name: input.serverName?.trim() || input.guildId,
    setupMode: "manual_first",
  });
  await ensurePrimaryServerLeagueLink(serverResult.server.id, league.id);
  await supabase.from("rec_leagues").update({ discord_bot_enabled: true, updated_at: new Date().toISOString() }).eq("id", league.id);
  await syncBoxScoreCommandForLeague(input.guildId, league.id);

  return { linked: true, server: { id: serverResult.server.id, name: serverResult.server.name }, leagueName: league.name };
}

function buildCommissionerNickname(teamDisplayName: string): string {
  const suffix = " (Commissioner)";
  const maxBase = Math.max(0, 32 - suffix.length);
  const base = teamDisplayName.length > maxBase ? teamDisplayName.slice(0, maxBase).trim() : teamDisplayName;
  return `${base}${suffix}`;
}

/**
 * The "second cycle" of Discord setup — called from the wizard once the commissioner reports
 * they've clicked the invite link. Confirms the bot has actually landed in the guild (rather
 * than trusting the click), then does the parts of onboarding that used to require a manual
 * follow-up: pushes the bot's managed roles as high in the hierarchy as it's allowed, grants
 * the commissioner their Commissioner role + a nickname built from the team they picked during
 * setup, and reports which of the standard channel routes are/aren't wired yet so the
 * commissioner knows exactly what's left before pointing them at League Mgmt > Settings.
 */
export async function completeDiscordPostInviteSetup(input: { leagueId: string; requestedByUserId: string }) {
  const league = await supabase.from("rec_leagues").select("id,game").eq("id", input.leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
  if (!league.data) throw new ApiError(404, "League not found.");

  const link = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", input.leagueId).eq("is_primary", true).maybeSingle();
  if (link.error) throw new ApiError(500, "Failed to load Discord server link.", link.error);
  if (!link.data) throw new ApiError(404, "This league has no Discord server connected yet.");

  const server = await supabase.from("rec_discord_servers").select("guild_id").eq("id", link.data.server_id).maybeSingle();
  if (server.error) throw new ApiError(500, "Failed to load Discord server.", server.error);
  if (!server.data) throw new ApiError(404, "Discord server record not found.");
  const guildId = server.data.guild_id;

  const botJoined = await isBotInGuild(guildId).catch(() => false);
  if (!botJoined) {
    return { botJoined: false as const, nicknameSet: false, channels: [] as Array<{ key: string; label: string; configured: boolean; maddenOnly: boolean }> };
  }

  await ensureManagedRolesPositioned(guildId).catch((error) => console.error("[WARN] Failed to position managed roles after bot invite:", error));

  let nicknameSet = false;
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.requestedByUserId).maybeSingle();
  if (account.data?.discord_id) {
    try {
      const commissionerRoleId = await ensureManagedRoleId(guildId, "commissioner");
      await addMemberRole(guildId, account.data.discord_id, commissionerRoleId, "REC post-invite setup — league commissioner");
      const assignment = await supabase
        .from("rec_team_assignments")
        .select("team:rec_teams(name,display_nick,is_relocated,display_city)")
        .eq("league_id", input.leagueId)
        .eq("user_id", input.requestedByUserId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .maybeSingle();
      const team = assignment.data?.team as { name?: string | null; display_nick?: string | null; is_relocated?: boolean | null; display_city?: string | null } | null;
      const teamDisplayName = team ? (formatTeamDisplayName(team) ?? team.name ?? "Commissioner") : "Commissioner";
      await setGuildMemberNickname(guildId, account.data.discord_id, buildCommissionerNickname(teamDisplayName), "REC post-invite setup — commissioner nickname");
      nicknameSet = true;
    } catch (error) {
      console.error("[WARN] Failed to set commissioner role/nickname after bot invite:", error);
    }
  }

  const routes = await supabase.from("rec_server_routes").select("*").eq("server_id", link.data.server_id).maybeSingle();
  const routeRow = (routes.data ?? {}) as Record<string, unknown>;
  const channels = Object.entries(REC_ROUTE_CHANNELS)
    .filter(([, config]) => !("madden_only" in config && config.madden_only) || league.data.game !== "cfb_27")
    .map(([key, config]) => ({
      key,
      label: config.label,
      configured: Boolean(routeRow[config.dbField]),
      maddenOnly: "madden_only" in config && Boolean(config.madden_only),
    }));

  return { botJoined: true as const, nicknameSet, channels };
}
