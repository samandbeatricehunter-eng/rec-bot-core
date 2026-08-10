import { ApiError } from "../../lib/errors.js";
import { listInstallableDiscordGuilds } from "../../lib/discord-oauth.js";
import { supabase } from "../../lib/supabase.js";
import { registerServer } from "../setup/setup.service.js";
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

  return {
    linked: true as const,
    server: { id: serverResult.server.id, name: serverResult.server.name },
    serverLeagueLink: link,
  };
}
