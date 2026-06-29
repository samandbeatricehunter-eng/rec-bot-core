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

type AttributeAllocation = { code: string; points: number; core: boolean };

// Re-derive each allocation's core flag from the league's configured core attribute set so
// price and caps are computed from trusted config, not client input.
function normalizeAttributeAllocations(details: Record<string, unknown>, cfgRow: Record<string, unknown>): Record<string, unknown> {
  const coreSet = new Set(Array.isArray(cfgRow.core_attributes) ? (cfgRow.core_attributes as unknown[]).map(String) : []);
  const raw = Array.isArray((details as any).allocations) ? ((details as any).allocations as any[]) : [];
  const allocations: AttributeAllocation[] = raw
    .map((a) => ({ code: String(a.code), points: Math.max(0, Math.floor(Number(a.points) || 0)), core: coreSet.has(String(a.code)) }))
    .filter((a) => a.points > 0);
  if (!allocations.length) throw new ApiError(400, "Select at least one attribute and a point amount.");
  return { ...details, allocations };
}

// Enforce points-per-user-per-season caps: each core attribute against its effective cap
// (override ?? default), and non-core points against one total cap. 0 ⇒ unlimited.
async function enforceAttributeCaps(args: {
  leagueId: string;
  userId: string;
  seasonNumber: number;
  allocations: AttributeAllocation[];
  defaultCoreCap: number;
  nonCoreCap: number;
  overrides: Record<string, number>;
}) {
  const existing = await supabase
    .from("rec_purchases")
    .select("details")
    .eq("league_id", args.leagueId)
    .eq("user_id", args.userId)
    .eq("purchase_type", "attribute")
    .eq("season_number", args.seasonNumber)
    .in("status", ACTIVE_STATUSES as unknown as string[]);
  if (existing.error) throw new ApiError(500, "Failed to check attribute caps.", existing.error);

  const usedByCode: Record<string, number> = {};
  let usedNonCore = 0;
  for (const row of existing.data ?? []) {
    const allocs = ((row as any).details?.allocations as any[]) ?? [];
    for (const a of allocs) {
      const pts = Math.max(0, Number(a.points) || 0);
      usedByCode[a.code] = (usedByCode[a.code] ?? 0) + pts;
      if (!a.core) usedNonCore += pts;
    }
  }

  let requestedNonCore = 0;
  for (const a of args.allocations) {
    if (a.core) {
      const cap = Number(args.overrides[a.code] ?? args.defaultCoreCap ?? 0);
      if (cap > 0 && (usedByCode[a.code] ?? 0) + a.points > cap) {
        throw new ApiError(409, `${a.code} is capped at ${cap} points per season — you've already used ${usedByCode[a.code] ?? 0}.`);
      }
    } else {
      requestedNonCore += a.points;
    }
  }
  if (args.nonCoreCap > 0 && usedNonCore + requestedNonCore > args.nonCoreCap) {
    throw new ApiError(409, `Non-core attribute points are capped at ${args.nonCoreCap} per season — you've already used ${usedNonCore}.`);
  }
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

  const attrSelect = input.purchaseType === "attribute"
    ? ["core_attributes", "core_attribute_cap_overrides", "core_attribute_purchases_season_cap", "non_core_attribute_purchases_season_cap"]
    : [];
  const selectCols = ["coin_economy_enabled", cfg.enabled, cfg.seasonCap, ...attrSelect].filter(Boolean).join(",");
  const config = await supabase
    .from("rec_league_configuration")
    .select(selectCols)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load league purchase configuration.", config.error);
  const cfgRow = (config.data ?? {}) as Record<string, unknown>;
  if (!cfgRow.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");
  if (!cfgRow[cfg.enabled]) throw new ApiError(400, `${label} purchases are not enabled for this league.`);

  // Attributes carry an allocation list; normalize core-ness server-side (authoritative) so
  // pricing and cap enforcement can't be spoofed by the client.
  let details: Record<string, unknown> = input.details ?? {};
  if (input.purchaseType === "attribute") {
    details = normalizeAttributeAllocations(details, cfgRow);
  }

  const price = priceForPurchase(input.purchaseType, details);
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

  if (input.purchaseType === "attribute") {
    await enforceAttributeCaps({
      leagueId,
      userId,
      seasonNumber,
      allocations: (details.allocations as AttributeAllocation[]) ?? [],
      defaultCoreCap: Number(cfgRow.core_attribute_purchases_season_cap ?? 0),
      nonCoreCap: Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0),
      overrides: (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {},
    });
  } else if (cfg.seasonCap) {
    // Count-based season cap: 0/absent ⇒ unlimited (the enabled flag governs availability).
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
      details,
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
