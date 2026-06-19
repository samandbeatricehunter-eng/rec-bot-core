import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

type SetServerConfigInput = {
  guildId: string;
  pendingEconomyChannelId?: string | null;
  pendingPayoutsChannelId?: string | null;
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
  const payload = compactDefined({
    server_id: context.serverId,
    pending_economy_channel_id: input.pendingEconomyChannelId,
    pending_payouts_channel_id: input.pendingPayoutsChannelId,
    game_channels_category_id: input.gameChannelsCategoryId,
    commissioner_office_channel_id: input.commissionerOfficeChannelId,
    streams_channel_id: input.streamsChannelId,
    highlights_channel_id: input.highlightsChannelId,
    announcements_channel_id: input.announcementsChannelId,
    voting_polls_channel_id: input.votingPollsChannelId,
    commissioner_role_id: input.commissionerRoleId,
    comp_committee_role_id: input.compCommitteeRoleId
  });

  const result = await supabase
    .from("rec_server_routes")
    .upsert(payload, { onConflict: "server_id" })
    .select("*")
    .single();

  if (result.error) throw new ApiError(500, "Failed to update server route configuration.", result.error);

  return {
    server: context.rec_discord_servers,
    league: context.rec_leagues,
    routes: result.data
  };
}
