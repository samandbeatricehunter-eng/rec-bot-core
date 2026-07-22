import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { registerServer } from "../setup/setup.service.js";
import { assertLeagueNotFrozen } from "./entitlements.service.js";

export type ClaimBotInviteInput = {
  token: string;
  guildId: string;
  serverName?: string;
  requestedByDiscordId?: string;
};

/**
 * Attaches a Discord guild to a Platinum-owned league using the invite token
 * generated when the owner enables the Discord bot on the site.
 * Keeps the invite token so the owner can re-share; does not disable the bot.
 */
export async function claimBotInvite(input: ClaimBotInviteInput) {
  const token = input.token?.trim();
  if (!token) throw new ApiError(400, "Invite token is required.");
  if (!input.guildId?.trim()) throw new ApiError(400, "guildId is required.");

  const leagueResult = await supabase
    .from("rec_leagues")
    .select("*")
    .eq("discord_bot_invite_token", token)
    .eq("discord_bot_enabled", true)
    .maybeSingle();

  if (leagueResult.error) throw new ApiError(500, "Failed to look up invite token.", leagueResult.error);
  if (!leagueResult.data) throw new ApiError(404, "Invalid or expired Discord bot invite token.");

  const league = leagueResult.data;
  await assertLeagueNotFrozen(league.id);

  const serverResult = await registerServer({
    guildId: input.guildId,
    name: input.serverName?.trim() || input.guildId,
    setupMode: "manual_first",
    requestedByDiscordId: input.requestedByDiscordId,
  });

  const existingPrimary = await supabase
    .from("rec_server_league_links")
    .select("id,league_id,is_primary")
    .eq("server_id", serverResult.server.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (existingPrimary.error) {
    throw new ApiError(500, "Failed to look up existing primary league link.", existingPrimary.error);
  }

  if (existingPrimary.data?.league_id && existingPrimary.data.league_id !== league.id) {
    throw new ApiError(
      409,
      "This Discord server is already linked to a different primary league. Unlink or delete that league before claiming another.",
    );
  }

  const existingSame = await supabase
    .from("rec_server_league_links")
    .select("id,league_id,is_primary")
    .eq("server_id", serverResult.server.id)
    .eq("league_id", league.id)
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
        server_id: serverResult.server.id,
        league_id: league.id,
        is_primary: true,
      })
      .select("*")
      .single();
    if (inserted.error) throw new ApiError(500, "Failed to link league to server.", inserted.error);
    link = inserted.data;
  }

  return {
    league,
    server: serverResult.server,
    linked: true as const,
    serverLeagueLink: link,
  };
}