import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getEaFranchises, type EaCompanionToken, type RecEaConsole } from "./ea-companion-client.js";

export type DiscoverEaFranchisesInput = {
  discordId: string;
  console?: RecEaConsole;
};

function toCompanionToken(account: Record<string, any>): EaCompanionToken {
  if (!account.access_token || !account.refresh_token || !account.expires_at || !account.blaze_id) {
    throw new ApiError(409, "EA account is missing token data. Reconnect EA before discovering franchises.");
  }

  return {
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiry: new Date(account.expires_at),
    console: account.console as RecEaConsole,
    blazeId: String(account.blaze_id)
  };
}

async function loadRecentImports(externalLeagueIds: string[]) {
  if (externalLeagueIds.length === 0) return new Map<string, any[]>();

  const result = await supabase
    .from("rec_import_jobs")
    .select("id,ea_external_league_id,import_label,import_scope,selected_endpoint_keys,status,created_at,completed_at")
    .in("ea_external_league_id", externalLeagueIds)
    .order("created_at", { ascending: false });

  if (result.error) {
    throw new ApiError(500, "Failed to load recent import history for discovered franchises.", result.error);
  }

  const map = new Map<string, any[]>();
  for (const row of result.data ?? []) {
    const key = String(row.ea_external_league_id ?? "");
    if (!key) continue;
    const current = map.get(key) ?? [];
    if (current.length < 3) current.push(row);
    map.set(key, current);
  }

  return map;
}

export async function discoverEaFranchises(input: DiscoverEaFranchisesInput) {
  const accountQuery = supabase
    .from("rec_ea_accounts")
    .select("*")
    .eq("discord_id", input.discordId)
    .order("updated_at", { ascending: false });

  const accounts = input.console
    ? await accountQuery.eq("console", input.console).limit(1)
    : await accountQuery.limit(1);

  if (accounts.error) {
    throw new ApiError(500, "Failed to load EA account.", accounts.error);
  }

  const account = accounts.data?.[0];
  if (!account) {
    throw new ApiError(404, "No connected EA account was found for this Discord user.");
  }

  const discovered = await getEaFranchises(toCompanionToken(account));
  const now = new Date().toISOString();

  const updatedAccount = await supabase
    .from("rec_ea_accounts")
    .update({
      access_token: discovered.token.accessToken,
      refresh_token: discovered.token.refreshToken,
      expires_at: discovered.token.expiry.toISOString(),
      blaze_id: discovered.token.blazeId,
      updated_at: now
    })
    .eq("id", account.id)
    .select("*")
    .single();

  if (updatedAccount.error) {
    throw new ApiError(500, "Failed to update EA account token after discovery.", updatedAccount.error);
  }

  const rows = discovered.franchises.map((franchise) => ({
    ea_account_id: account.id,
    external_league_id: String(franchise.leagueId),
    league_name: franchise.leagueName,
    console: discovered.token.console,
    season_text: franchise.seasonText ?? null,
    season_sort: franchise.seasonSort ?? null,
    calendar_year: franchise.calendarYear ?? null,
    num_members: franchise.numMembers ?? null,
    user_team_external_id: franchise.userTeamId ? String(franchise.userTeamId) : null,
    user_team_name: franchise.userTeamName ?? null,
    is_importable: franchise.isImportable ?? null,
    raw_payload: franchise.raw,
    last_discovered_at: now,
    updated_at: now
  }));

  const upserted = rows.length > 0
    ? await supabase
      .from("rec_ea_franchises")
      .upsert(rows, { onConflict: "external_league_id,console" })
      .select("*")
    : { data: [], error: null };

  if (upserted.error) {
    throw new ApiError(500, "Failed to store discovered EA franchises.", upserted.error);
  }

  const importHistory = await loadRecentImports((upserted.data ?? []).map((row: any) => String(row.external_league_id)));

  return {
    account: {
      id: updatedAccount.data.id,
      discordId: updatedAccount.data.discord_id,
      console: updatedAccount.data.console,
      blazeId: updatedAccount.data.blaze_id
    },
    franchises: (upserted.data ?? []).map((franchise: any) => ({
      ...franchise,
      recentImports: importHistory.get(String(franchise.external_league_id)) ?? []
    }))
  };
}
