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

  const { error } = await supabase.from("rec_site_discord_config").upsert({ id: true, ...update });
  if (error) throw new ApiError(500, "Failed to save Discord config.", error);
  return getSiteDiscordConfig();
}

/** What the bot's daily sweep needs: the one exempt guild, plus every guild actually linked
 * to a league on the site — anything else the bot sits in gets left. */
export async function getDiscordGovernanceSnapshot(): Promise<{ managementGuildId: string | null; linkedGuildIds: string[] }> {
  const [config, links] = await Promise.all([
    getSiteDiscordConfig(),
    supabase.from("rec_server_league_links").select("server:rec_discord_servers(guild_id)"),
  ]);
  if (links.error) throw new ApiError(500, "Failed to load linked guilds.", links.error);
  const linkedGuildIds: string[] = Array.from(new Set<string>(
    (links.data ?? [])
      .map((row: any) => (Array.isArray(row.server) ? row.server[0]?.guild_id : row.server?.guild_id))
      .filter((id: unknown): id is string => Boolean(id)),
  ));
  return { managementGuildId: config.managementGuildId, linkedGuildIds };
}
