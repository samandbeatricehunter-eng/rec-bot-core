import { priceForPurchase, REC_PURCHASE_TYPE_LABELS, type RecPurchaseType } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { getUserBaselineByDiscordId } from "../users/user.service.js";

// purchase_type → the rec_league_configuration columns that gate it. seasonCap null means the
// type uses a more specific cap model handled elsewhere (attributes use per-attribute caps).
const PURCHASE_CONFIG: Record<RecPurchaseType, { enabled: string; seasonCap: string | null }> = {
  age_reset: { enabled: "age_resets_enabled", seasonCap: "age_resets_season_cap" },
  dev_upgrade: { enabled: "dev_upgrades_enabled", seasonCap: "dev_upgrades_season_cap" },
  contract: { enabled: "contract_adjustment_purchases_enabled", seasonCap: "contract_purchases_season_cap" },
  player_trait: { enabled: "player_trait_purchases_enabled", seasonCap: "player_trait_purchases_season_cap" },
  attribute: { enabled: "attribute_purchases_enabled", seasonCap: null },
  legend: { enabled: "legends_enabled", seasonCap: "legends_season_cap" },
  custom_player: { enabled: "custom_players_enabled", seasonCap: "custom_players_season_cap" },
};

// Statuses that count as "active or successful" toward a season cap / all-time metric.
const ACTIVE_STATUSES = ["pending", "approved", "fulfilled"] as const;

function purchaseLabel(type: RecPurchaseType) {
  return REC_PURCHASE_TYPE_LABELS[type] ?? "Purchase";
}

export async function createPurchaseRequest(input: {
  guildId: string;
  discordId: string;
  purchaseType: RecPurchaseType;
  details: Record<string, unknown>;
}) {
  const cfg = PURCHASE_CONFIG[input.purchaseType];
  if (!cfg) throw new ApiError(400, "Unknown purchase type.");
  const label = purchaseLabel(input.purchaseType);

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;

  const selectCols = ["coin_economy_enabled", cfg.enabled, cfg.seasonCap].filter(Boolean).join(",");
  const config = await supabase
    .from("rec_league_configuration")
    .select(selectCols)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load league purchase configuration.", config.error);
  const cfgRow = (config.data ?? {}) as Record<string, unknown>;
  if (!cfgRow.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");
  if (!cfgRow[cfg.enabled]) throw new ApiError(400, `${label} purchases are not enabled for this league.`);

  const price = priceForPurchase(input.purchaseType, input.details);
  if (!Number.isFinite(price) || price <= 0) {
    throw new ApiError(400, "Could not determine a price for this purchase.");
  }

  const baseline = await getUserBaselineByDiscordId(input.discordId);
  const userId = baseline.user.id;
  const walletBalance = Number(baseline.wallet?.wallet_balance ?? 0);
  if (walletBalance < price) {
    throw new ApiError(400, `Insufficient wallet balance. This costs $${price} and you have $${walletBalance}.`);
  }

  const seasonNumber = resolveSeasonNumber(context);
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  // Season cap: 0/absent ⇒ unlimited (the enabled flag governs availability).
  if (cfg.seasonCap) {
    const cap = Number(cfgRow[cfg.seasonCap] ?? 0);
    if (cap > 0) {
      const used = await supabase
        .from("rec_purchases")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .eq("purchase_type", input.purchaseType)
        .eq("season_number", seasonNumber)
        .in("status", ACTIVE_STATUSES as unknown as string[]);
      if (used.error) throw new ApiError(500, "Failed to check season purchase cap.", used.error);
      if ((used.count ?? 0) >= cap) {
        throw new ApiError(409, `You have reached this season's cap (${cap}) for ${label}.`);
      }
    }
  }

  const now = new Date().toISOString();
  const inserted = await supabase
    .from("rec_purchases")
    .insert({
      league_id: leagueId,
      season_id: seasonId,
      season_number: seasonNumber,
      user_id: userId,
      discord_id: input.discordId,
      purchase_type: input.purchaseType,
      cost: price,
      details: input.details ?? {},
      status: "pending",
      already_deducted: false,
      submitted_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to create purchase request.", inserted.error);

  // Deduct on request. If the debit fails, roll back the pending row so we never leave a
  // request without a charge.
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: -price,
    p_league_id: leagueId,
    p_description: `${label} purchase`,
    p_transaction_type: "purchase_debit",
    p_source: "purchase",
    p_source_reference: { purchaseId: inserted.data.id },
  });
  if (ledger.error) {
    await supabase.from("rec_purchases").delete().eq("id", inserted.data.id);
    throw new ApiError(500, "Failed to debit wallet for purchase.", ledger.error);
  }

  const finalized = await supabase
    .from("rec_purchases")
    .update({ debit_ledger_id: ledger.data, already_deducted: true, updated_at: new Date().toISOString() })
    .eq("id", inserted.data.id)
    .select("*")
    .single();
  if (finalized.error) throw new ApiError(500, "Failed to finalize purchase request.", finalized.error);

  return {
    purchase: finalized.data,
    price,
    walletBalance: walletBalance - price,
    pendingPurchasesChannelId: (context.routes as any)?.pending_purchases_channel_id ?? null,
  };
}

export async function reviewPurchase(input: {
  purchaseId: string;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
}) {
  const existing = await supabase.from("rec_purchases").select("*").eq("id", input.purchaseId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load purchase.", existing.error);
  if (!existing.data) throw new ApiError(404, "Purchase was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Purchase is already ${existing.data.status}.`, purchase: existing.data };
  }

  const label = purchaseLabel(existing.data.purchase_type as RecPurchaseType);
  const now = new Date().toISOString();

  if (input.action === "deny") {
    let refundLedgerId: string | null = null;
    const cost = Number(existing.data.cost ?? 0);
    if (existing.data.already_deducted && cost > 0) {
      const refund = await supabase.rpc("add_to_wallet", {
        p_user_id: existing.data.user_id,
        p_amount: cost,
        p_league_id: existing.data.league_id,
        p_description: `${label} purchase refund`,
        p_transaction_type: "purchase_refund",
        p_source: "purchase",
        p_source_reference: { purchaseId: existing.data.id, refund: true },
      });
      if (refund.error) throw new ApiError(500, "Failed to refund denied purchase.", refund.error);
      refundLedgerId = refund.data;
    }
    const denied = await supabase
      .from("rec_purchases")
      .update({
        status: "rejected",
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        admin_notes: input.deniedReason ?? null,
        reviewed_by_discord_id: input.reviewedByDiscordId,
        refund_ledger_id: refundLedgerId,
        updated_at: now,
      })
      .eq("id", input.purchaseId)
      .select("*")
      .single();
    if (denied.error) throw new ApiError(500, "Failed to deny purchase.", denied.error);
    return { updated: true, action: "deny" as const, purchase: denied.data, refunded: cost, buyerDiscordId: existing.data.discord_id };
  }

  const approved = await supabase
    .from("rec_purchases")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", input.purchaseId)
    .select("*")
    .single();
  if (approved.error) throw new ApiError(500, "Failed to approve purchase.", approved.error);
  return { updated: true, action: "approve" as const, purchase: approved.data, buyerDiscordId: existing.data.discord_id };
}

export async function listPendingPurchases(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_purchases")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load pending purchases.", error);
  return {
    purchases: data ?? [],
    pendingPurchasesChannelId: (context.routes as any)?.pending_purchases_channel_id ?? null,
  };
}

// Per-type counts for the store landing: season-active (counts toward cap) and all-time
// successful (approved/fulfilled) for metrics.
export async function getUserPurchaseCounts(discordId: string, guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const baseline = await getUserBaselineByDiscordId(discordId);
  const seasonNumber = resolveSeasonNumber(context);

  const { data, error } = await supabase
    .from("rec_purchases")
    .select("purchase_type,status,season_number")
    .eq("league_id", context.leagueId)
    .eq("user_id", baseline.user.id);
  if (error) throw new ApiError(500, "Failed to load purchase counts.", error);

  const seasonActive: Record<string, number> = {};
  const allTimeSuccessful: Record<string, number> = {};
  for (const row of data ?? []) {
    const type = String(row.purchase_type);
    if (Number(row.season_number) === seasonNumber && (ACTIVE_STATUSES as unknown as string[]).includes(String(row.status))) {
      seasonActive[type] = (seasonActive[type] ?? 0) + 1;
    }
    if (row.status === "approved" || row.status === "fulfilled") {
      allTimeSuccessful[type] = (allTimeSuccessful[type] ?? 0) + 1;
    }
  }

  return { seasonNumber, seasonActive, allTimeSuccessful };
}
