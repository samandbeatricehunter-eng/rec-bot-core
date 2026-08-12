// Singleton site-wide Discord config (management server + per-game-type league-post
// channels), and the guild-governance snapshot the bot's daily unlinked-server sweep reads.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type SiteDiscordConfig = {
  managementGuildId: string | null;
  leaguePostChannels: { madden_26: string | null; madden_27: string | null; cfb_27: string | null };
};

const LEAGUE_POST_GAMES = ["madden_26", "madden_27", "cfb_27"] as const;

function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
  if (patch.managementGuildId !== undefined) update.management_guild_id = emptyToNull(patch.managementGuildId);
  if (patch.leaguePostChannels?.madden_26 !== undefined) {
    update.league_post_channel_madden_26 = emptyToNull(patch.leaguePostChannels.madden_26);
  }
  if (patch.leaguePostChannels?.madden_27 !== undefined) {
    update.league_post_channel_madden_27 = emptyToNull(patch.leaguePostChannels.madden_27);
  }
  if (patch.leaguePostChannels?.cfb_27 !== undefined) {
    update.league_post_channel_cfb_27 = emptyToNull(patch.leaguePostChannels.cfb_27);
  }

  const { data, error } = await supabase.from("rec_site_discord_config").upsert({ id: true, ...update }).select("*").single();
  if (error) throw new ApiError(500, `Failed to save Discord config: ${error.message}`, error);

  const saved: SiteDiscordConfig = {
    managementGuildId: data.management_guild_id ?? null,
    leaguePostChannels: {
      madden_26: data.league_post_channel_madden_26 ?? null,
      madden_27: data.league_post_channel_madden_27 ?? null,
      cfb_27: data.league_post_channel_cfb_27 ?? null,
    },
  };

  // Backfill open-league ads whenever any post channel is configured (including no-op saves
  // after channels were set outside this API).
  const anyChannelSet = LEAGUE_POST_GAMES.some((game) => Boolean(saved.leaguePostChannels[game]));
  if (anyChannelSet) {
    void syncAllRecruitingAds().catch((err) => console.error("[WARN] Recruiting-ad sync after Discord config save failed:", err));
  }

  return saved;
}

/** Sync recruiting-board embeds for every game-type channel currently configured. */
export async function syncAllRecruitingAds(): Promise<{ synced: string[] }> {
  const config = await getSiteDiscordConfig();
  const synced: string[] = [];
  const { syncAllRecruitingAdsForGame } = await import("../recruiting-board/recruiting-board.service.js");
  for (const game of LEAGUE_POST_GAMES) {
    if (!config.leaguePostChannels[game]) continue;
    await syncAllRecruitingAdsForGame(game);
    synced.push(game);
  }
  return { synced };
}

/** What the bot's daily sweep needs: the one exempt guild, plus every guild actually linked
 * to a league on the site — anything else the bot sits in gets left. */
export async function getDiscordGovernanceSnapshot(): Promise<{ managementGuildId: string | null; linkedGuildIds: string[] }> {
  // Two-query path: the custom Postgres client does not support PostgREST `!inner` embeds
  // (or dotted filter columns on related tables). Primary links → server guild ids.
  const [config, links] = await Promise.all([
    getSiteDiscordConfig(),
    supabase.from("rec_server_league_links").select("server_id").eq("is_primary", true),
  ]);
  if (links.error) throw new ApiError(500, "Failed to load linked guilds.", links.error);

  const serverIds = [
    ...new Set(
      (links.data ?? [])
        .map((row) => (typeof row.server_id === "string" ? row.server_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (serverIds.length === 0) {
    return { managementGuildId: config.managementGuildId, linkedGuildIds: [] };
  }

  const servers = await supabase.from("rec_discord_servers").select("guild_id").in("id", serverIds);
  if (servers.error) throw new ApiError(500, "Failed to load linked guilds.", servers.error);

  const linkedGuildIds: string[] = [];
  for (const row of servers.data ?? []) {
    if (typeof row.guild_id === "string" && row.guild_id.length > 0 && !linkedGuildIds.includes(row.guild_id)) {
      linkedGuildIds.push(row.guild_id);
    }
  }
  return { managementGuildId: config.managementGuildId, linkedGuildIds };
}
