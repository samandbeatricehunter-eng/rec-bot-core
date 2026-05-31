import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getEaFranchises, getEaLoginUrl, type EaCompanionToken, type RecEaConsole } from "./ea-companion-client.js";

export async function startEaConnect(input: { discordId: string }) {
  const account = await supabase
    .from("rec_ea_accounts")
    .upsert({
      discord_id: input.discordId,
      connection_status: "pending"
    }, { onConflict: "discord_id" })
    .select("*")
    .single();

  if (account.error) {
    throw new ApiError(500, "Failed to initialize EA connection.", account.error);
  }

  return {
    account: account.data,
    loginUrl: getEaLoginUrl(),
    message: "Open this URL to authenticate with EA. Callback token exchange will be wired next."
  };
}

export async function listStoredEaFranchises(input: { discordId: string }) {
  const account = await supabase
    .from("rec_ea_accounts")
    .select("id, discord_id, ea_persona_id, ea_display_name, connection_status, last_synced_at")
    .eq("discord_id", input.discordId)
    .maybeSingle();

  if (account.error) {
    throw new ApiError(500, "Failed to load EA account.", account.error);
  }

  if (!account.data) {
    return { account: null, franchises: [] };
  }

  const franchises = await supabase
    .from("rec_ea_franchises")
    .select("*")
    .eq("ea_account_id", account.data.id)
    .order("last_seen_at", { ascending: false });

  if (franchises.error) {
    throw new ApiError(500, "Failed to load EA franchises.", franchises.error);
  }

  return { account: account.data, franchises: franchises.data ?? [] };
}

export async function syncEaFranchises(input: { discordId: string }) {
  const account = await supabase
    .from("rec_ea_accounts")
    .select("*")
    .eq("discord_id", input.discordId)
    .maybeSingle();

  if (account.error) {
    throw new ApiError(500, "Failed to load EA account.", account.error);
  }

  if (!account.data) {
    throw new ApiError(404, "EA account is not connected for this Discord user.");
  }

  if (!account.data.access_token_encrypted || !account.data.refresh_token_encrypted || !account.data.token_expires_at) {
    throw new ApiError(409, "EA account exists but does not have usable Madden Companion tokens yet.");
  }

  const token: EaCompanionToken = {
    accessToken: account.data.access_token_encrypted,
    refreshToken: account.data.refresh_token_encrypted,
    expiry: new Date(account.data.token_expires_at),
    console: (account.data.preferred_console ?? "xbsx") as RecEaConsole,
    blazeId: account.data.ea_persona_id ?? ""
  };

  const discovered = await getEaFranchises(token);

  const rows = discovered.franchises.map((franchise) => ({
    ea_account_id: account.data.id,
    external_league_id: String(franchise.leagueId),
    external_league_name: franchise.leagueName,
    season_number: franchise.seasonSort ?? null,
    season_stage: franchise.seasonText ?? null,
    current_week: null,
    platform: token.console,
    raw_payload: franchise.raw,
    last_seen_at: new Date().toISOString()
  }));

  if (rows.length > 0) {
    const saved = await supabase
      .from("rec_ea_franchises")
      .upsert(rows, { onConflict: "ea_account_id,external_league_id" })
      .select("*");

    if (saved.error) {
      throw new ApiError(500, "Failed to save EA franchises.", saved.error);
    }
  }

  const updatedAccount = await supabase
    .from("rec_ea_accounts")
    .update({
      ea_persona_id: discovered.token.blazeId,
      connection_status: "connected",
      access_token_encrypted: discovered.token.accessToken,
      refresh_token_encrypted: discovered.token.refreshToken,
      token_expires_at: discovered.token.expiry.toISOString(),
      last_synced_at: new Date().toISOString()
    })
    .eq("id", account.data.id)
    .select("id, discord_id, ea_persona_id, ea_display_name, connection_status, last_synced_at")
    .single();

  if (updatedAccount.error) {
    throw new ApiError(500, "Failed to update EA account sync state.", updatedAccount.error);
  }

  return listStoredEaFranchises({ discordId: input.discordId });
}
