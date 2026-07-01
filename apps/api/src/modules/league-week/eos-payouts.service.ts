import { REC_END_SEASON_PAYOUTS, evaluatePayoutTier, isEosPayoutEligibleStage } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

type EosPayoutItem = {
  league_id: string;
  user_id: string;
  team_id: string | null;
  season_number: number;
  payout_category: string;
  payout_key: string;
  payout_label: string;
  qualified_tier: string | null;
  qualified_value: number;
  amount: number;
  metadata: Record<string, unknown>;
};

export const TEAM_DEFINITIONS = REC_END_SEASON_PAYOUTS.filter((definition) => definition.scope === "team");
const RANK_DEFINITION = REC_END_SEASON_PAYOUTS.find((definition) => definition.key === "power_ranking_position");

function num(value: unknown) {
  return Number(value) || 0;
}

function jsonNum(raw: unknown, key: string) {
  if (!raw || typeof raw !== "object") return 0;
  return num((raw as Record<string, unknown>)[key]);
}

export function evalTeamStat(statKey: string, rows: any[]) {
  const games = rows.length;
  const sum = (key: string) => rows.reduce((total, row) => total + num(row[key]), 0);
  const jsonSum = (sourceKey: string, key: string) => rows.reduce((total, row) => total + jsonNum(row[sourceKey], key), 0);
  if (statKey === "points_per_game") return games ? sum("points_for") / games : 0;
  if (statKey === "points_allowed_per_game") return games ? sum("points_against") / games : 0;
  if (statKey === "team_interceptions") return jsonSum("defensive_stats", "interceptions") || sum("generated_turnovers");
  if (statKey === "total_yards_allowed") return sum("yards_allowed");
  if (statKey === "team_sacks") return jsonSum("defensive_stats", "sacks");
  if (statKey === "turnover_differential") return sum("generated_turnovers") - sum("turnovers_committed");
  if (statKey === "total_offense_yards") return sum("total_yards_gained") || sum("off_yards_gained");
  if (statKey === "red_zone_td_rate") {
    const values = rows.map((row) => row.red_zone_off_percentage).filter((value) => value != null).map(num);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  if (statKey === "red_zone_td_rate_allowed") {
    const values = rows.map((row) => row.red_zone_def_percentage).filter((value) => value != null).map(num);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
  }
  return 0;
}

async function loadOrCreateBatch(leagueId: string, seasonNumber: number, requestedByDiscordId: string) {
  const existing = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("batch_type", "eos_regular_season")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load EOS payout batch.", existing.error);
  if (existing.data) return existing.data;

  const creator = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", requestedByDiscordId).maybeSingle();
  const created = await supabase
    .from("rec_eos_payout_batches")
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      batch_type: "eos_regular_season",
      status: "draft",
      created_by_user_id: creator.data?.user_id ?? null,
    })
    .select("*")
    .single();
  if (created.error) throw new ApiError(500, "Failed to create EOS payout batch.", created.error);
  return created.data;
}

async function buildPowerRankItems(leagueId: string, seasonNumber: number): Promise<EosPayoutItem[]> {
  if (!RANK_DEFINITION) return [];
  const rankRows = await supabase.rpc("rec_eos_rank_payouts", { p_league_id: leagueId, p_season_number: seasonNumber });
  if (rankRows.error) throw new ApiError(500, "Failed to calculate power-ranking EOS payouts.", rankRows.error);
  const assignments = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load EOS team assignments.", assignments.error);
  const teamByUser = new Map((assignments.data ?? []).map((row) => [row.user_id, row.team_id]));

  return (rankRows.data ?? [])
    .filter((row: any) => Number(row.rank_amount ?? 0) > 0)
    .map((row: any) => ({
      league_id: leagueId,
      user_id: row.user_id,
      team_id: teamByUser.get(row.user_id) ?? null,
      season_number: seasonNumber,
      payout_category: "ranking",
      payout_key: `eos:${seasonNumber}:power_rank:${row.user_id}`,
      payout_label: row.rank_label ?? RANK_DEFINITION.label,
      qualified_tier: evaluatePayoutTier(Number(row.rank), RANK_DEFINITION.tiers)?.tier ?? null,
      qualified_value: Number(row.rank),
      amount: Number(row.rank_amount),
      metadata: { rank: Number(row.rank), source: "power_rankings" },
    }));
}

async function buildTeamStatItems(leagueId: string, seasonNumber: number): Promise<EosPayoutItem[]> {
  const stats = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", 18)
    .not("user_id", "is", null);
  if (stats.error) throw new ApiError(500, "Failed to load EOS team stats.", stats.error);

  const byUser = new Map<string, any[]>();
  for (const row of stats.data ?? []) {
    const rows = byUser.get(row.user_id) ?? [];
    rows.push(row);
    byUser.set(row.user_id, rows);
  }

  const items: EosPayoutItem[] = [];
  for (const [userId, rows] of byUser.entries()) {
    const teamId = rows.find((row) => row.team_id)?.team_id ?? null;
    for (const definition of TEAM_DEFINITIONS) {
      const value = evalTeamStat(definition.statKey, rows);
      const tier = evaluatePayoutTier(value, definition.tiers);
      if (!tier) continue;
      items.push({
        league_id: leagueId,
        user_id: userId,
        team_id: teamId,
        season_number: seasonNumber,
        payout_category: "team",
        payout_key: `eos:${seasonNumber}:${definition.key}:${userId}`,
        payout_label: definition.label,
        qualified_tier: tier.tier,
        qualified_value: Math.round(value * 100) / 100,
        amount: tier.amount,
        metadata: { statKey: definition.statKey, games: rows.length },
      });
    }
  }
  return items;
}

export async function prepareEosPayouts(input: { guildId: string; requestedByDiscordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  if (!isEosPayoutEligibleStage(currentStage, context.rec_leagues.game)) {
    throw new ApiError(400, "EOS payouts are only available during the postseason (after the regular season ends, through the championship game).");
  }
  const seasonNumber = resolveSeasonNumber(context);
  const batch = await loadOrCreateBatch(context.leagueId, seasonNumber, input.requestedByDiscordId);
  const existingIssued = await supabase
    .from("rec_eos_payout_items")
    .select("id")
    .eq("batch_id", batch.id)
    .in("status", ["approved", "issued"])
    .limit(1);
  if (existingIssued.error) throw new ApiError(500, "Failed to check existing EOS payout items.", existingIssued.error);

  const items = [...await buildPowerRankItems(context.leagueId, seasonNumber), ...await buildTeamStatItems(context.leagueId, seasonNumber)];
  if (!(existingIssued.data ?? []).length) {
    await supabase.from("rec_eos_payout_items").delete().eq("batch_id", batch.id).eq("status", "pending");
    if (items.length) {
      const insert = await supabase.from("rec_eos_payout_items").upsert(
        items.map((item) => ({ ...item, batch_id: batch.id, status: "pending" })),
        { onConflict: "batch_id,payout_key" },
      );
      if (insert.error) throw new ApiError(500, "Failed to save EOS payout items.", insert.error);
    }
  }

  const loaded = await listEosPayoutBatch(batch.id);
  return {
    ...loaded,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
  };
}

export async function projectEosPayouts(input: { guildId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const items = [...await buildPowerRankItems(context.leagueId, seasonNumber), ...await buildTeamStatItems(context.leagueId, seasonNumber)];
  const withDiscord = await attachPayeeDiscordIds(items);
  const totalAmount = withDiscord.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  return {
    league: {
      id: context.leagueId,
      seasonNumber,
      currentWeek: Number(context.rec_leagues.current_week ?? 1),
      seasonStage: context.rec_leagues.season_stage ?? "regular_season",
    },
    items: withDiscord,
    totalAmount,
  };
}

async function attachPayeeDiscordIds(items: any[]): Promise<any[]> {
  const userIds = [...new Set(items.map((item) => item.user_id).filter(Boolean))];
  if (!userIds.length) return items.map((item) => ({ ...item, payee_discord_id: null }));
  const accounts = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds);
  const discordByUser = new Map((accounts.data ?? []).map((row) => [row.user_id, row.discord_id]));
  return items.map((item) => ({ ...item, payee_discord_id: discordByUser.get(item.user_id) ?? null }));
}

export async function listEosPayoutBatch(batchId: string) {
  const batch = await supabase.from("rec_eos_payout_batches").select("*").eq("id", batchId).maybeSingle();
  if (batch.error) throw new ApiError(500, "Failed to load EOS payout batch.", batch.error);
  if (!batch.data) throw new ApiError(404, "EOS payout batch was not found.");
  const items = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", batchId)
    .order("payout_category", { ascending: true })
    .order("amount", { ascending: false });
  if (items.error) throw new ApiError(500, "Failed to load EOS payout items.", items.error);
  const withDiscord = await attachPayeeDiscordIds(items.data ?? []);
  const totalAmount = withDiscord.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  return { batch: batch.data, items: withDiscord, totalAmount };
}

// Approve or deny ALL of one coach's pending EOS items in a batch, so the bot
// can post a single per-coach review embed. Returns the processed items (with
// labels/tiers/values) and the coach's Discord id for the payout DM.
export async function reviewEosPayoutsForUser(input: {
  batchId: string;
  userId: string;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
}) {
  const pending = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", input.batchId)
    .eq("user_id", input.userId)
    .eq("status", "pending");
  if (pending.error) throw new ApiError(500, "Failed to load EOS payout items for coach.", pending.error);

  const processed: any[] = [];
  const failed: any[] = [];
  for (const item of pending.data ?? []) {
    try {
      const result = await reviewEosPayoutItem({
        itemId: item.id,
        action: input.action,
        reviewedByDiscordId: input.reviewedByDiscordId,
        deniedReason: input.deniedReason,
      });
      if (result.updated) processed.push(result.item);
    } catch (error) {
      failed.push({ itemId: item.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.userId).maybeSingle();
  const totalAmount = processed.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  return { action: input.action, userId: input.userId, payeeDiscordId: account.data?.discord_id ?? null, items: processed, failed, totalAmount };
}

export async function reviewEosPayoutItem(input: { itemId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const existing = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load EOS payout item.", existing.error);
  if (!existing.data) throw new ApiError(404, "EOS payout item was not found.");
  if (existing.data.status !== "pending") return { updated: false, reason: `Item is already ${existing.data.status}.`, item: existing.data };

  const reviewer = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.reviewedByDiscordId).maybeSingle();
  if (input.action === "deny") {
    const denied = await supabase
      .from("rec_eos_payout_items")
      .update({
        status: "denied",
        denied_by_user_id: reviewer.data?.user_id ?? null,
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        denied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.itemId)
      .select("*")
      .single();
    if (denied.error) throw new ApiError(500, "Failed to deny EOS payout item.", denied.error);
    return { updated: true, item: denied.data };
  }

  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: existing.data.user_id,
    p_amount: Number(existing.data.amount ?? 0),
    p_league_id: existing.data.league_id,
    p_description: `EOS payout - ${existing.data.payout_label}`,
    p_transaction_type: "eos_payout",
    p_source: "eos",
    p_source_reference: { itemId: existing.data.id, batchId: existing.data.batch_id, payoutKey: existing.data.payout_key },
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue EOS payout.", ledger.error);

  const issued = await supabase
    .from("rec_eos_payout_items")
    .update({
      status: "issued",
      approved_by_user_id: reviewer.data?.user_id ?? null,
      issued_ledger_id: ledger.data,
      approved_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.itemId)
    .select("*")
    .single();
  if (issued.error) throw new ApiError(500, "Failed to mark EOS payout issued.", issued.error);
  return { updated: true, item: issued.data };
}

export async function issueEosPayoutBatch(input: { batchId: string; reviewedByDiscordId: string }) {
  const batch = await listEosPayoutBatch(input.batchId);
  const pending = batch.items.filter((item: any) => item.status === "pending");
  const issued = [];
  const failed = [];
  for (const item of pending) {
    try {
      const result = await reviewEosPayoutItem({ itemId: item.id, action: "approve", reviewedByDiscordId: input.reviewedByDiscordId });
      issued.push(result.item);
    } catch (error) {
      failed.push({ itemId: item.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const refreshed = await listEosPayoutBatch(input.batchId);
  const issuedItems = await attachPayeeDiscordIds(issued);
  const stillPending = refreshed.items.filter((item: any) => item.status === "pending").length;
  await supabase
    .from("rec_eos_payout_batches")
    .update({
      status: failed.length ? "failed" : stillPending ? "partially_approved" : "issued",
      issued_at: failed.length ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.batchId);
  return { ...refreshed, issuedCount: issued.length, issuedItems, failed };
}
