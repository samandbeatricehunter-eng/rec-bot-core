import { REC_ROUTE_CHANNELS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

type SetServerConfigInput = {
  guildId: string;
  pendingEconomyChannelId?: string | null;
  boxScoresChannelId?: string | null;
  weeklySubmissionsChannelId?: string | null;
  recGuideChannelId?: string | null;
  powerRankingsChannelId?: string | null;
  gameChannelsCategoryId?: string | null;
  streamsChannelId?: string | null;
  highlightsChannelId?: string | null;
  announcementsChannelId?: string | null;
  commissionerRoleId?: string | null;
  compCommitteeRoleId?: string | null;
  tradeBlockChannelId?: string | null;
  votingPollsChannelId?: string | null;
  schedulingChannelId?: string | null;
  matchupsChannelId?: string | null;
  interviewsChannelId?: string | null;
  tweetsChannelId?: string | null;
  playerOfTheWeekChannelId?: string | null;
  rosterMovementChannelId?: string | null;
  finalizedTradesChannelId?: string | null;
  leagueLeadersChannelId?: string | null;
  recordHoldersChannelId?: string | null;
  ownersChatChannelId?: string | null;
  offensiveProsChannelId?: string | null;
  defensiveProsChannelId?: string | null;
  hofMilestonesChannelId?: string | null;
  proTrackerChannelId?: string | null;
};

function compactDefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeRouteValue(value: unknown) {
  if (value === "") return null;
  return value;
}

function routePayload(input: Record<string, unknown>) {
  const payload = Object.fromEntries(
    Object.values(REC_ROUTE_CHANNELS).map((config) => [config.dbField, normalizeRouteValue(input[config.inputField])])
  );
  return payload;
}

// Used by the bot's post-join grace-period check: a guild the bot sits in without a
// primary rec_server_league_links row (via rec_discord_servers.guild_id) means the site
// Connect-Discord flow never finished — stale invite, wrong server, or a manual add.
// The column is guild_id (not discord_guild_id); querying the wrong name always returned
// unlinked and made the bot leave every newly invited league server after the grace period.
export async function isGuildLinkedToLeague(guildId: string): Promise<boolean> {
  const server = await supabase.from("rec_discord_servers").select("id").eq("guild_id", guildId).maybeSingle();
  if (server.error || !server.data) return false;
  const link = await supabase
    .from("rec_server_league_links")
    .select("id")
    .eq("server_id", server.data.id)
    .eq("is_primary", true)
    .maybeSingle();
  if (link.error) return false;
  return Boolean(link.data);
}

export async function getServerConfig(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const configuration = await supabase.from("rec_league_configuration").select("*").eq("league_id", context.leagueId).maybeSingle();
  return {
    server: context.rec_discord_servers,
    league: context.rec_leagues,
    routes: normalizeRouteAliases(context.routes ?? {}),
    configuration: configuration.data ?? {},
  };
}

function normalizeRouteAliases(routes: Record<string, any>) {
  return routes;
}

export async function setServerConfig(input: SetServerConfigInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (!context.serverId) {
    throw new ApiError(400, "This league has no linked Discord server — channel routing is a Discord-only feature.");
  }
  const updatePayload = compactDefined({
    pending_economy_channel_id: input.pendingEconomyChannelId,
    ...routePayload(input),
    commissioner_role_id: input.commissionerRoleId,
    comp_committee_role_id: input.compCommitteeRoleId
  });

  const existing = await supabase
    .from("rec_server_routes")
    .select("*")
    .eq("server_id", context.serverId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load server route configuration.", existing.error);

  if (Object.keys(updatePayload).length === 0) {
    return {
      server: context.rec_discord_servers,
      league: context.rec_leagues,
      routes: normalizeRouteAliases(existing.data ?? {})
    };
  }

  const result = existing.data
    ? await supabase
        .from("rec_server_routes")
        .update(updatePayload)
        .eq("server_id", context.serverId)
        .select("*")
        .single()
    : await supabase
        .from("rec_server_routes")
        .insert({ server_id: context.serverId, ...updatePayload })
        .select("*")
        .single();

  if (result.error) throw new ApiError(500, "Failed to update server route configuration.", result.error);

  if (input.schedulingChannelId && input.schedulingChannelId !== (existing.data as any)?.scheduling_channel_id) {
    const { syncAvailabilityBoard } = await import("../scheduling/availability-board.service.js");
    syncAvailabilityBoard(input.guildId, { announceLinked: true }).catch((error) => console.error("[ERROR] Failed to post availability board after channel assignment (non-fatal):", error));
  }

  return {
    server: context.rec_discord_servers,
    league: context.rec_leagues,
    routes: normalizeRouteAliases(result.data)
  };
}
