import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

type SetServerConfigInput = {
  guildId: string;
  pendingEconomyChannelId?: string | null;
  pendingPayoutsChannelId?: string | null;
  pendingPurchasesChannelId?: string | null;
  boxScoresChannelId?: string | null;
  headlinesChannelId?: string | null;
  powerRankingsChannelId?: string | null;
  gameChannelsCategoryId?: string | null;
  commissionerOfficeChannelId?: string | null;
  streamsChannelId?: string | null;
  highlightsChannelId?: string | null;
  announcementsChannelId?: string | null;
  votingPollsChannelId?: string | null;
  commissionerRoleId?: string | null;
  compCommitteeRoleId?: string | null;
};

function compactDefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export async function getServerConfig(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  return {
    server: context.rec_discord_servers,
    league: context.rec_leagues,
    routes: context.routes ?? {}
  };
}

export async function setServerConfig(input: SetServerConfigInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const updatePayload = compactDefined({
    pending_economy_channel_id: input.pendingEconomyChannelId,
    pending_payouts_channel_id: input.pendingPayoutsChannelId,
    pending_purchases_channel_id: input.pendingPurchasesChannelId,
    box_scores_channel_id: input.boxScoresChannelId,
    headlines_channel_id: input.headlinesChannelId,
    power_rankings_channel_id: input.powerRankingsChannelId,
    game_channels_category_id: input.gameChannelsCategoryId,
    commissioner_office_channel_id: input.commissionerOfficeChannelId,
    streams_channel_id: input.streamsChannelId,
    highlights_channel_id: input.highlightsChannelId,
    announcements_channel_id: input.announcementsChannelId,
    voting_polls_channel_id: input.votingPollsChannelId,
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
      routes: existing.data ?? {}
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
    routes: result.data
  };
}
