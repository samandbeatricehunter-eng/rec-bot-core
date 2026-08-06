import { priceForPurchase, REC_PURCHASE_TYPE_LABELS, formatCoins, devTierOrderForGame, type RecPurchaseType, type RecDevTier } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { assertSiteAccountForEconomy } from "../subscriptions/discord-only.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { getUserBaselineByDiscordId } from "../users/user.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { assertPurchaseDeadlineOpen } from "./purchase-deadlines.js";

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

// CFB 27's configured store does not open until Season 2. Madden has no such restriction.
const CFB_SEASON_ONE_LOCKED_PURCHASE_TYPES: RecPurchaseType[] = ["custom_player", "legend", "dev_upgrade", "attribute", "player_trait", "age_reset", "contract"];

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

// Enforce points-per-user-per-season caps. Every cap is additive, not either/or: a purchase
// must clear BOTH its own attribute's individual cap (override, else the group default) AND
// its group's pooled total. 0 on any cap ⇒ that particular constraint is unlimited.
async function enforceAttributeCaps(args: {
  leagueId: string;
  userId: string;
  seasonNumber: number;
  allocations: AttributeAllocation[];
  defaultCoreCap: number;
  coreGroupCap: number;
  coreOverrides: Record<string, number>;
  nonCoreGroupCap: number;
  nonCoreOverrides: Record<string, number>;
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
  let usedCore = 0;
  let usedNonCore = 0;
  for (const row of existing.data ?? []) {
    const allocs = ((row as any).details?.allocations as any[]) ?? [];
    for (const a of allocs) {
      const pts = Math.max(0, Number(a.points) || 0);
      usedByCode[a.code] = (usedByCode[a.code] ?? 0) + pts;
      if (a.core) usedCore += pts;
      else usedNonCore += pts;
    }
  }

  let requestedCore = 0;
  let requestedNonCore = 0;
  for (const a of args.allocations) {
    if (a.core) {
      const cap = Number(args.coreOverrides[a.code] ?? args.defaultCoreCap ?? 0);
      if (cap > 0 && (usedByCode[a.code] ?? 0) + a.points > cap) {
        throw new ApiError(409, `${a.code} is capped at ${cap} points per season — you've already used ${usedByCode[a.code] ?? 0}.`);
      }
      requestedCore += a.points;
    } else {
      const cap = Number(args.nonCoreOverrides[a.code] ?? 0);
      if (cap > 0 && (usedByCode[a.code] ?? 0) + a.points > cap) {
        throw new ApiError(409, `${a.code} is capped at ${cap} points per season — you've already used ${usedByCode[a.code] ?? 0}.`);
      }
      requestedNonCore += a.points;
    }
  }
  if (args.coreGroupCap > 0 && usedCore + requestedCore > args.coreGroupCap) {
    throw new ApiError(409, `Core attribute points are capped at ${args.coreGroupCap} total per season — you've already used ${usedCore}.`);
  }
  if (args.nonCoreGroupCap > 0 && usedNonCore + requestedNonCore > args.nonCoreGroupCap) {
    throw new ApiError(409, `Non-core attribute points are capped at ${args.nonCoreGroupCap} total per season — you've already used ${usedNonCore}.`);
  }
}

// Re-derives fromTier from the player's actual current dev_trait (never trust the client for
// this) and validates toTier is a real forward step on this league's game-family tier ladder.
async function normalizeDevUpgradeDetails(details: Record<string, unknown>, leagueId: string, game: string, userId: string): Promise<Record<string, unknown>> {
  const playerId = String((details as any).playerId ?? "");
  if (!playerId) throw new ApiError(400, "Select a player to upgrade.");
  const player = await supabase.from("rec_players").select("id,team_id,full_name,dev_trait,roster_status").eq("id", playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data || player.data.roster_status !== "active") throw new ApiError(404, "Player not found on an active roster.");
  const assignment = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment.data?.team_id || assignment.data.team_id !== player.data.team_id) throw new ApiError(403, "You can only upgrade your own team's players.");

  const order = devTierOrderForGame(game);
  const fromTier = (order.includes(player.data.dev_trait as RecDevTier) ? player.data.dev_trait : "normal") as RecDevTier;
  const toTier = String((details as any).toTier ?? "") as RecDevTier;
  if (order.indexOf(toTier) <= order.indexOf(fromTier)) {
    throw new ApiError(400, `${player.data.full_name} is already at or above that tier.`);
  }
  return { playerId, playerName: player.data.full_name, fromTier, toTier };
}

// Enforces one of two league-configured cap modes for dev upgrades: a flat count of purchase
// actions per season (reuses the generic seasonCap path below), or a cap on how many DISTINCT
// players a team can upgrade in a season — once a player has an active dev_upgrade purchase
// this season they're already "in", so further purchases on that same player never consume a
// new slot (they can climb as many tiers as they want once chosen).
async function enforceDevUpgradePlayerCap(args: { leagueId: string; userId: string; seasonNumber: number; playerId: string; cap: number }) {
  if (args.cap <= 0) return;
  const existing = await supabase.from("rec_purchases").select("details")
    .eq("league_id", args.leagueId).eq("user_id", args.userId).eq("purchase_type", "dev_upgrade").eq("season_number", args.seasonNumber)
    .in("status", ACTIVE_STATUSES as unknown as string[]);
  if (existing.error) throw new ApiError(500, "Failed to check dev upgrade player cap.", existing.error);
  const distinctPlayerIds = new Set((existing.data ?? []).map((row: any) => row.details?.playerId).filter(Boolean));
  if (distinctPlayerIds.has(args.playerId)) return;
  if (distinctPlayerIds.size >= args.cap) {
    throw new ApiError(409, `This league limits dev upgrades to ${args.cap} player(s) per team per season — you've already chosen your ${args.cap}.`);
  }
}

export async function createPurchaseRequest(input: {
  guildId: string;
  discordId: string;
  purchaseType: RecPurchaseType;
  details: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const cfg = PURCHASE_CONFIG[input.purchaseType];
  if (!cfg) throw new ApiError(400, "Unknown purchase type.");
  const label = purchaseLabel(input.purchaseType);

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;

  const attrSelect = input.purchaseType === "attribute"
    ? ["core_attributes", "core_attribute_cap_overrides", "core_attribute_purchases_season_cap", "core_attribute_group_cap", "non_core_attribute_purchases_season_cap", "non_core_attribute_cap_overrides"]
    : input.purchaseType === "dev_upgrade"
      ? ["dev_upgrade_cap_mode", "dev_upgrades_player_cap"]
      : [];
  const selectCols = ["coin_economy_enabled", "purchase_deadlines", cfg.enabled, cfg.seasonCap, ...attrSelect].filter(Boolean).join(",");
  const config = await supabase
    .from("rec_league_configuration")
    .select(selectCols)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load league purchase configuration.", config.error);
  const cfgRow = (config.data ?? {}) as Record<string, unknown>;
  if (!cfgRow.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");
  const { assertEconomyPayoutsActive } = await import("../economy/economy-gate.js");
  await assertEconomyPayoutsActive(leagueId);
  if (!cfgRow[cfg.enabled]) throw new ApiError(400, `${label} purchases are not enabled for this league.`);
  assertPurchaseDeadlineOpen({
    purchaseType: input.purchaseType,
    deadlines: cfgRow.purchase_deadlines,
    currentStage: String(context.rec_leagues?.season_stage ?? "regular_season"),
    currentWeek: Number(context.rec_leagues?.current_week ?? 1),
  });

  const seasonNumber = resolveSeasonNumber(context);
  if (context.rec_leagues?.game === "cfb_27" && seasonNumber < 2 && CFB_SEASON_ONE_LOCKED_PURCHASE_TYPES.includes(input.purchaseType)) {
    throw new ApiError(400, `${label} purchases open in Season 2 — Season 1 rosters are locked while dynasties get established.`);
  }

  const baseline = await getUserBaselineByDiscordId(input.discordId);
  const userId = baseline.user.id;
  await assertSiteAccountForEconomy(userId);

  // A retried/duplicated submit (network hiccup, double-click) with the same client-generated
  // key returns the original request instead of creating (and charging for) a second one —
  // mirrors the same pattern custom-player builds already use.
  if (input.idempotencyKey) {
    const existing = await supabase.from("rec_purchases").select("*")
      .eq("league_id", leagueId).eq("user_id", userId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing.error) throw new ApiError(500, "Failed to check for a duplicate purchase.", existing.error);
    if (existing.data) return { purchase: existing.data, duplicate: true };
  }

  // Attributes carry an allocation list; dev upgrades carry a player + target tier — both
  // get normalized server-side (authoritative) so pricing and cap enforcement can't be
  // spoofed by client-supplied core/tier flags.
  let details: Record<string, unknown> = input.details ?? {};
  if (input.purchaseType === "attribute") {
    details = normalizeAttributeAllocations(details, cfgRow);
  } else if (input.purchaseType === "dev_upgrade") {
    details = await normalizeDevUpgradeDetails(details, leagueId, String(context.rec_leagues?.game ?? "madden_27"), userId);
  }

  const price = priceForPurchase(input.purchaseType, details, String(context.rec_leagues?.game ?? ""));
  if (!Number.isFinite(price) || price <= 0) {
    throw new ApiError(400, "Could not determine a price for this purchase.");
  }

  const walletBalance = Number(baseline.wallet?.wallet_balance ?? 0);
  if (walletBalance < price) {
    throw new ApiError(400, `Insufficient wallet balance. This costs ${formatCoins(price)} and you have ${formatCoins(walletBalance)}.`);
  }

  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  // Every cap here is a count/aggregate over existing rows checked, then a separate insert —
  // two concurrent requests can both pass this check against the same pre-insert snapshot and
  // both succeed, exceeding the cap. Run once now (fail fast, no wasted insert/debit for the
  // common non-racing case), and run again below AFTER the insert commits, when a concurrent
  // request's row (if any) is actually visible — that second call is the real guard.
  async function enforceCaps() {
    if (input.purchaseType === "dev_upgrade" && cfgRow.dev_upgrade_cap_mode === "players_per_season") {
      await enforceDevUpgradePlayerCap({
        leagueId, userId, seasonNumber,
        playerId: String((details as any).playerId),
        cap: Number(cfgRow.dev_upgrades_player_cap ?? 0),
      });
    } else if (input.purchaseType === "attribute") {
      await enforceAttributeCaps({
        leagueId,
        userId,
        seasonNumber,
        allocations: (details.allocations as AttributeAllocation[]) ?? [],
        defaultCoreCap: Number(cfgRow.core_attribute_purchases_season_cap ?? 0),
        coreGroupCap: Number(cfgRow.core_attribute_group_cap ?? 0),
        coreOverrides: (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {},
        nonCoreGroupCap: Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0),
        nonCoreOverrides: (cfgRow.non_core_attribute_cap_overrides as Record<string, number>) ?? {},
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
  }
  await enforceCaps();

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
      idempotency_key: input.idempotencyKey ?? null,
      submitted_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (inserted.error) {
    // 23505 here is either the idempotency key racing with itself (a genuinely-concurrent
    // retry) or the legend-uniqueness index (rec_purchases_legend_unique_active) firing.
    if ((inserted.error as { code?: string }).code === "23505") {
      if (input.purchaseType === "legend") throw new ApiError(409, "This legend has already been purchased in this league.");
      if (input.idempotencyKey) {
        const existing = await supabase.from("rec_purchases").select("*")
          .eq("league_id", leagueId).eq("user_id", userId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
        if (existing.data) return { purchase: existing.data, duplicate: true };
      }
    }
    throw new ApiError(500, "Failed to create purchase request.", inserted.error);
  }

  // Real guard against the TOCTOU race enforceCaps() above can't fully close on its own: recount
  // with the just-inserted row now actually committed and visible. A losing concurrent request's
  // own insert is also visible to THIS recount by the time both have landed, so whichever request
  // reaches this point last is the one that (correctly) self-aborts — see enforceCaps() above.
  try {
    if (input.purchaseType === "dev_upgrade" && cfgRow.dev_upgrade_cap_mode === "players_per_season") {
      const cap = Number(cfgRow.dev_upgrades_player_cap ?? 0);
      if (cap > 0) {
        const rows = await supabase.from("rec_purchases").select("details")
          .eq("league_id", leagueId).eq("user_id", userId).eq("purchase_type", "dev_upgrade").eq("season_number", seasonNumber)
          .in("status", ACTIVE_STATUSES as unknown as string[]);
        if (rows.error) throw new ApiError(500, "Failed to verify dev upgrade player cap.", rows.error);
        const distinctPlayerIds = new Set((rows.data ?? []).map((row: any) => row.details?.playerId).filter(Boolean));
        if (distinctPlayerIds.size > cap) {
          throw new ApiError(409, `This league limits dev upgrades to ${cap} player(s) per team per season — someone else just claimed the last slot.`);
        }
      }
    } else if (input.purchaseType === "attribute") {
      const rows = await supabase.from("rec_purchases").select("details")
        .eq("league_id", leagueId).eq("user_id", userId).eq("purchase_type", "attribute").eq("season_number", seasonNumber)
        .in("status", ACTIVE_STATUSES as unknown as string[]);
      if (rows.error) throw new ApiError(500, "Failed to verify attribute caps.", rows.error);
      const usedByCode: Record<string, number> = {};
      let usedCore = 0, usedNonCore = 0;
      for (const row of rows.data ?? []) {
        for (const a of ((row as any).details?.allocations as any[]) ?? []) {
          const pts = Math.max(0, Number(a.points) || 0);
          usedByCode[a.code] = (usedByCode[a.code] ?? 0) + pts;
          if (a.core) usedCore += pts; else usedNonCore += pts;
        }
      }
      const coreOverrides = (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {};
      const nonCoreOverrides = (cfgRow.non_core_attribute_cap_overrides as Record<string, number>) ?? {};
      const defaultCoreCap = Number(cfgRow.core_attribute_purchases_season_cap ?? 0);
      const coreGroupCap = Number(cfgRow.core_attribute_group_cap ?? 0);
      const nonCoreGroupCap = Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0);
      for (const [code, used] of Object.entries(usedByCode)) {
        const allocation = ((details.allocations as AttributeAllocation[]) ?? []).find((a) => a.code === code);
        const isCore = allocation?.core ?? false;
        const cap = Number((isCore ? coreOverrides[code] : nonCoreOverrides[code]) ?? (isCore ? defaultCoreCap : 0));
        if (cap > 0 && used > cap) throw new ApiError(409, `${code} is capped at ${cap} points per season — someone else's request just filled it.`);
      }
      if (coreGroupCap > 0 && usedCore > coreGroupCap) throw new ApiError(409, `Core attribute points are capped at ${coreGroupCap} total per season — someone else's request just filled it.`);
      if (nonCoreGroupCap > 0 && usedNonCore > nonCoreGroupCap) throw new ApiError(409, `Non-core attribute points are capped at ${nonCoreGroupCap} total per season — someone else's request just filled it.`);
    } else if (cfg.seasonCap) {
      const cap = Number(cfgRow[cfg.seasonCap] ?? 0);
      if (cap > 0) {
        const used = await supabase
          .from("rec_purchases")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId).eq("user_id", userId).eq("purchase_type", input.purchaseType).eq("season_number", seasonNumber)
          .in("status", ACTIVE_STATUSES as unknown as string[]);
        if (used.error) throw new ApiError(500, "Failed to verify season purchase cap.", used.error);
        if ((used.count ?? 0) > cap) {
          throw new ApiError(409, `You have reached this season's cap (${cap}) for ${label} — someone else's request just filled it.`);
        }
      }
    }
  } catch (capError) {
    await supabase.from("rec_purchases").delete().eq("id", inserted.data.id);
    throw capError;
  }

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

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: leagueId,
    season_number: seasonNumber,
    week_number: null,
    queue_type: "purchase",
    status: "pending",
    priority: 0,
    header: `Purchase: ${label} — ${formatCoins(price)}`,
    summary: `${label} requested by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    amount: price,
    source_table: "rec_purchases",
    source_id: finalized.data.id,
    payload: { purchaseId: finalized.data.id, purchaseType: input.purchaseType, cost: price },
  });
  void notifyLeagueCommissionersOfPendingItem(leagueId);

  return {
    purchase: finalized.data,
    price,
    walletBalance: walletBalance - price,
  };
}

export async function reviewPurchase(input: {
  purchaseId: string;
  leagueId?: string | null;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
  // Legend/Custom Recruit only: the commissioner's final call on which roster player this
  // replaces — independent of whatever the buyer requested. Undefined leaves details
  // untouched; null explicitly records "commissioner chose not to designate one".
  finalReplaceTarget?: { position: string; firstName: string; lastName: string } | null;
}) {
  let purchaseQuery = supabase.from("rec_purchases").select("*").eq("id", input.purchaseId);
  if (input.leagueId) purchaseQuery = purchaseQuery.eq("league_id", input.leagueId);
  const existing = await purchaseQuery.maybeSingle();
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
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now, review_reason: input.deniedReason ?? null })
      .eq("source_table", "rec_purchases")
      .eq("source_id", input.purchaseId);
    return { updated: true, action: "deny" as const, purchase: denied.data, refunded: cost, buyerDiscordId: existing.data.discord_id };
  }

  const approved = await supabase
    .from("rec_purchases")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      approved_at: now,
      updated_at: now,
      ...(input.finalReplaceTarget !== undefined
        ? { details: { ...(existing.data.details as Record<string, unknown>), finalReplaceTarget: input.finalReplaceTarget } }
        : {}),
    })
    .eq("id", input.purchaseId)
    .select("*")
    .single();
  if (approved.error) throw new ApiError(500, "Failed to approve purchase.", approved.error);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
    .eq("source_table", "rec_purchases")
    .eq("source_id", input.purchaseId);
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

const SEASON_CAP_COLUMNS: Partial<Record<RecPurchaseType, string>> = {
  age_reset: "age_resets_season_cap",
  dev_upgrade: "dev_upgrades_season_cap",
  contract: "contract_purchases_season_cap",
  player_trait: "player_trait_purchases_season_cap",
  legend: "legends_season_cap",
  custom_player: "custom_players_season_cap",
};

/**
 * Everything the web Store needs to price and cap-check purchases client-side before
 * submitting — core-attribute set, per-attribute cap overrides, non-core cap, this
 * season's already-used points per attribute, and the simple count-based season caps
 * for every other purchase type. The server still re-derives and re-enforces all of
 * this authoritatively on submit (createPurchaseRequest above); this is a preview only.
 */
export async function getStorePurchaseContext(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const baseline = await getUserBaselineByDiscordId(discordId);
  const seasonNumber = resolveSeasonNumber(context);

  const config = await supabase
    .from("rec_league_configuration")
    .select("core_attributes,core_attribute_cap_overrides,core_attribute_purchases_season_cap,core_attribute_group_cap,non_core_attribute_purchases_season_cap,non_core_attribute_cap_overrides,age_resets_season_cap,dev_upgrades_season_cap,contract_purchases_season_cap,player_trait_purchases_season_cap,legends_season_cap,custom_players_season_cap")
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load store configuration.", config.error);
  const cfgRow = (config.data ?? {}) as Record<string, unknown>;

  const [existingAttrs, counts] = await Promise.all([
    supabase
      .from("rec_purchases")
      .select("details")
      .eq("league_id", context.leagueId)
      .eq("user_id", baseline.user.id)
      .eq("purchase_type", "attribute")
      .eq("season_number", seasonNumber)
      .in("status", ACTIVE_STATUSES as unknown as string[]),
    getUserPurchaseCounts(discordId, guildId),
  ]);
  if (existingAttrs.error) throw new ApiError(500, "Failed to load attribute purchase history.", existingAttrs.error);

  const usedCoreByCode: Record<string, number> = {};
  const usedNonCoreByCode: Record<string, number> = {};
  let usedCore = 0;
  let usedNonCore = 0;
  for (const row of existingAttrs.data ?? []) {
    const allocs = ((row as any).details?.allocations as any[]) ?? [];
    for (const a of allocs) {
      const pts = Math.max(0, Number(a.points) || 0);
      if (a.core) { usedCoreByCode[a.code] = (usedCoreByCode[a.code] ?? 0) + pts; usedCore += pts; }
      else { usedNonCoreByCode[a.code] = (usedNonCoreByCode[a.code] ?? 0) + pts; usedNonCore += pts; }
    }
  }

  const seasonCaps: Partial<Record<RecPurchaseType, number>> = {};
  for (const [type, column] of Object.entries(SEASON_CAP_COLUMNS)) {
    seasonCaps[type as RecPurchaseType] = Number(cfgRow[column as string] ?? 0);
  }

  return {
    seasonNumber,
    wallet: Number(baseline.wallet?.wallet_balance ?? 0),
    coreAttributes: Array.isArray(cfgRow.core_attributes) ? (cfgRow.core_attributes as unknown[]).map(String) : [],
    coreAttributeDefaultCap: Number(cfgRow.core_attribute_purchases_season_cap ?? 0),
    coreAttributeCapOverrides: (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {},
    coreAttributeGroupCap: Number(cfgRow.core_attribute_group_cap ?? 0),
    nonCoreAttributeCap: Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0),
    nonCoreAttributeCapOverrides: (cfgRow.non_core_attribute_cap_overrides as Record<string, number>) ?? {},
    usedCoreByCode,
    usedNonCoreByCode,
    usedCore,
    usedNonCore,
    seasonCaps,
    seasonActive: counts.seasonActive,
  };
}
