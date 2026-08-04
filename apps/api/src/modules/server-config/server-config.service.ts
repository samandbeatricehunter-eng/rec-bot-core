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
// rec_discord_servers row means /claim-league was never run (invite went stale, wrong server,
// or someone added the bot without ever creating/claiming a league). The bot should never
// linger in a server it has no league link to.
export async function isGuildLinkedToLeague(guildId: string): Promise<boolean> {
  const result = await supabase.from("rec_discord_servers").select("id").eq("discord_guild_id", guildId).maybeSingle();
  return Boolean(result.data);
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

  return {
    server: context.rec_discord_servers,
    league: context.rec_leagues,
    routes: normalizeRouteAliases(result.data)
  };
}
