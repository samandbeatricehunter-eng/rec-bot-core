// Shared utilities for advance sub-modules. Import from here; do NOT import from
// advance.service.ts (that creates a circular dependency since it re-exports everything).
import { readStat } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

export { supabase };

export function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function pickStat(stats: any, keys: string[]) {
  for (const key of keys) {
    if (stats?.[key] !== undefined && stats?.[key] !== null) return asNumber(stats[key]);
  }
  return 0;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function findLeagueContext(guildId: string) {
  const serverResult = await supabase
    .from("rec_discord_servers")
    .select("id,name,guild_id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (serverResult.error) throw serverResult.error;
  if (!serverResult.data) return null;

  const linkResult = await supabase
    .from("rec_server_league_links")
    .select("server_id, league_id")
    .eq("server_id", serverResult.data.id)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  if (linkResult.error) throw linkResult.error;
  if (!linkResult.data?.league_id) return null;

  const leagueResult = await supabase
    .from("rec_leagues")
    .select("*")
    .eq("id", linkResult.data.league_id)
    .maybeSingle();
  if (leagueResult.error) throw leagueResult.error;
  if (!leagueResult.data) return null;

  return {
    server_id: serverResult.data.id,
    league_id: linkResult.data.league_id,
    rec_discord_servers: serverResult.data,
    rec_leagues: leagueResult.data
  } as any;
}

export async function getLeagueContext(guildId: string) {
  const context = await findLeagueContext(guildId);
  if (!context) throw new Error("No REC league is set up for this Discord server.");
  return context;
}

export async function getLinkedActiveTeamUsers(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id,rec_teams(id,name,abbreviation,conference,division)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function getWalletBalance(userId: string) {
  const { data } = await supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", userId).maybeSingle();
  return { wallet: asNumber(data?.wallet_balance), savings: asNumber(data?.savings_balance) };
}

export async function getLeagueFeatureSettings(leagueId: string) {
  const { data, error } = await supabase.from("rec_league_feature_settings").select("*").eq("league_id", leagueId).maybeSingle();
  if (error) throw error;
  return data as any;
}

export async function sumTeamStatFromCommitted(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string, canonicalKeys: string[]): Promise<{ total: number; hasData: boolean }> {
  const { data, error } = await supabase
    .from("rec_player_weekly_stats")
    .select("stats")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("team_id", teamId);
  if (error || !data?.length) return { total: 0, hasData: false };
  const total = (data as any[]).reduce((sum, row) => {
    const s = (row.stats ?? {}) as Record<string, unknown>;
    return sum + canonicalKeys.reduce((ks, key) => ks + readStat(s, key), 0);
  }, 0);
  return { total, hasData: true };
}

export async function creditUserWallet(input: {
  userId: string;
  leagueId: string;
  seasonNumber: number;
  amount: number;
  transactionType: string;
  description: string;
  sourceReference: Record<string, unknown>;
}) {
  if (!input.amount) return { ledger: null, wallet: await getWalletBalance(input.userId), created: false };

  const idempotencyKey = String(input.sourceReference.idempotencyKey ?? "");
  if (idempotencyKey) {
    const existing = await supabase
      .from("rec_dollar_ledger")
      .select("*")
      .eq("user_id", input.userId)
      .eq("transaction_type", input.transactionType)
      .contains("source_reference", { idempotencyKey })
      .maybeSingle();
    if (existing.data) return { ledger: existing.data, wallet: await getWalletBalance(input.userId), created: false };
  }

  const { data: currentWallet, error: walletReadError } = await supabase
    .from("rec_wallets")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (walletReadError) throw walletReadError;

  if (currentWallet) {
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .update({ wallet_balance: asNumber(currentWallet.wallet_balance) + input.amount, updated_at: nowIso() })
      .eq("user_id", input.userId);
    if (walletError) throw walletError;
  } else {
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .insert({ user_id: input.userId, wallet_balance: input.amount, savings_balance: 0 });
    if (walletError) throw walletError;
  }

  const { data: ledger, error: ledgerError } = await supabase.from("rec_dollar_ledger").insert({
    user_id: input.userId,
    league_id: input.leagueId,
    season_id: null,
    amount: input.amount,
    transaction_type: input.transactionType,
    description: input.description,
    source: "internal_import",
    source_reference: input.sourceReference
  }).select("*").single();
  if (ledgerError) throw ledgerError;

  return { ledger, wallet: await getWalletBalance(input.userId), created: true };
}
