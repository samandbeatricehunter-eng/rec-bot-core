// Singleton site-wide Discord config (management server + per-game-type league-post
// channels), and the guild-governance snapshot the bot's daily unlinked-server sweep reads.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type SiteDiscordConfig = {
  managementGuildId: string | null;
  leaguePostChannels: { madden_26: string | null; madden_27: string | null; cfb_27: string | null };
};

export async function getSiteDiscordConfig(): Promise<SiteDiscordConfig> {
  const { data, error } = await supabase.from("rec_site_discord_config").select("*").eq("id", true).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load Discord config.", error);
  return {
    managementGuildId: data?.management_guild_id ?? null,
    leaguePostChannels: {
      madden_26: data?.league_post_channel_madden_26 ?? null,
      madden_27: data?.league_post_channel_madden_27 ?? null,
      cfb_27: data?.league_post_channel_cfb_27 ?? null,
    },
  };
}

export async function updateSiteDiscordConfig(patch: {
  managementGuildId?: string | null;
  leaguePostChannels?: Partial<SiteDiscordConfig["leaguePostChannels"]>;
}): Promise<SiteDiscordConfig> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.managementGuildId !== undefined) update.management_guild_id = patch.managementGuildId;
  if (patch.leaguePostChannels?.madden_26 !== undefined) update.league_post_channel_madden_26 = patch.leaguePostChannels.madden_26;
  if (patch.leaguePostChannels?.madden_27 !== undefined) update.league_post_channel_madden_27 = patch.leaguePostChannels.madden_27;
  if (patch.leaguePostChannels?.cfb_27 !== undefined) update.league_post_channel_cfb_27 = patch.leaguePostChannels.cfb_27;

  const { data, error } = await supabase.from("rec_site_discord_config").upsert({ id: true, ...update }).select("*").single();
  if (error) throw new ApiError(500, "Failed to save Discord config.", error);

  // Backfill: a league with open teams that predates this channel being set shouldn't have to
  // wait for its next roster event to appear on the board.
  if (patch.leaguePostChannels?.madden_26 !== undefined) void import("../recruiting-board/recruiting-board.service.js").then((mod) => mod.syncAllRecruitingAdsForGame("madden_26"));
  if (patch.leaguePostChannels?.madden_27 !== undefined) void import("../recruiting-board/recruiting-board.service.js").then((mod) => mod.syncAllRecruitingAdsForGame("madden_27"));
  if (patch.leaguePostChannels?.cfb_27 !== undefined) void import("../recruiting-board/recruiting-board.service.js").then((mod) => mod.syncAllRecruitingAdsForGame("cfb_27"));

  return {
    managementGuildId: data.management_guild_id ?? null,
    leaguePostChannels: {
      madden_26: data.league_post_channel_madden_26 ?? null,
      madden_27: data.league_post_channel_madden_27 ?? null,
      cfb_27: data.league_post_channel_cfb_27 ?? null,
    },
  };
}

/** What the bot's daily sweep needs: the one exempt guild, plus every guild actually linked
 * to a league on the site — anything else the bot sits in gets left. */
export async function getDiscordGovernanceSnapshot(): Promise<{ managementGuildId: string | null; linkedGuildIds: string[] }> {
  const [config, servers] = await Promise.all([
    getSiteDiscordConfig(),
    // Join from servers → primary links so we always get guild_id without relying on
    // PostgREST embed relationship naming (a prior bare embed could return empty and the
    // daily sweep would leave every league server).
    supabase
      .from("rec_discord_servers")
      .select("guild_id, rec_server_league_links!inner(id, is_primary)")
      .eq("rec_server_league_links.is_primary", true),
  ]);
  if (servers.error) throw new ApiError(500, "Failed to load linked guilds.", servers.error);
  const linkedGuildIds = Array.from(
    new Set(
      (servers.data ?? [])
        .map((row) => row.guild_id)
        .filter((id: unknown): id is string => Boolean(id)),
    ),
  );
  return { managementGuildId: config.managementGuildId, linkedGuildIds };
}
