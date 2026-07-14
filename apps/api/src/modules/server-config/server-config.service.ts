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
};

function compactDefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function routePayload(input: Record<string, unknown>) {
  const payload = Object.fromEntries(
    Object.values(REC_ROUTE_CHANNELS).map((config) => [config.dbField, input[config.inputField]])
  );
  // Preserve old callers while the deployed clients move to canonical naming.
  if (payload.weekly_submissions_channel_id === undefined && input.boxScoresChannelId !== undefined) {
    payload.weekly_submissions_channel_id = input.boxScoresChannelId;
  }
  if (payload.weekly_submissions_channel_id !== undefined) {
    payload.box_scores_channel_id = payload.weekly_submissions_channel_id;
  }
  return payload;
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
  const weekly = routes.weekly_submissions_channel_id ?? routes.box_scores_channel_id ?? null;
  return { ...routes, weekly_submissions_channel_id: weekly, box_scores_channel_id: routes.box_scores_channel_id ?? weekly };
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
