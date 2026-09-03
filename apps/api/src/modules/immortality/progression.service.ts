import { randomUUID } from "node:crypto";
import {
  characteristicCatalog,
  combinedModifiers,
  DEV_TRAIT_PROMOTION_XP_COST,
  effectiveDevTrait,
  evaluateSeasonTrend,
  FORMULA_VERSIONS,
  highestMedalForWeek,
  ledgerXpBalance,
  positionGroupFor,
  promotionPath,
  purchaseCharacteristic,
  purchaseDevTraitPromotion,
  purchaseTeammateDevTraitPromotion,
  startingDevTrait,
  type ImmortalityDevTrait,
  type ImmortalityPosition,
  type TrendMedal,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findServerRoutesForLeague, getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import {
  discordIdForRecUser,
  loadImmortalityLeague,
  recUserIdFromDiscordId,
  requireImmortalityLeague,
} from "./immortality.service.js";

const SELF_PROMOTION_SOURCES = ["season_trend", "self_purchase"] as const;
const ACTIVE_PROMOTION_STATUSES = ["pending", "applied"] as const;

async function loadProspectForUser(immortalityLeagueId: string, userId: string, side: "offense" | "defense") {
  const row = await supabase
    .from("rec_immortality_prospects")
    .select("*")
    .eq("immortality_league_id", immortalityLeagueId)
    .eq("user_id", userId)
    .eq("side", side)
    .maybeSingle();
  if (row.error) throw new ApiError(500, "Could not load your prospect.", row.error);
  return row.data;
}

async function modifiersAndCatalog(prospect: { id: string; position: string }) {
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const traits = await supabase.from("rec_immortality_prospect_characteristics")
    .select("characteristic_key,source,xp_spent")
    .eq("prospect_id", prospect.id);
  if (traits.error) throw new ApiError(500, "Could not load characteristics.", traits.error);
  const ownedKeys = (traits.data ?? []).map((row) => String(row.characteristic_key));
  const selected = catalog.filter((item) => ownedKeys.includes(item.key));
  return { catalog, traits: traits.data ?? [], ownedKeys, selected, modifiers: combinedModifiers(selected) };
}

async function playerXpFor(prospectId: string): Promise<number> {
  const ledger = await supabase.from("rec_immortality_xp_ledger")
    .select("player_xp_delta,team_xp_delta")
    .eq("prospect_id", prospectId);
  if (ledger.error) throw new ApiError(500, "Could not load Player XP.", ledger.error);
  return ledgerXpBalance(ledger.data ?? []).playerXp;
}

async function selfPromotionSteps(prospectId: string): Promise<number> {
  const rows = await supabase.from("rec_immortality_dev_promotions")
    .select("id")
    .eq("prospect_id", prospectId)
    .in("source", [...SELF_PROMOTION_SOURCES])
    .in("status", [...ACTIVE_PROMOTION_STATUSES])
    .is("target_player_id", null);
  if (rows.error) throw new ApiError(500, "Could not load development promotions.", rows.error);
  return (rows.data ?? []).length;
}

export async function recDevTraitForProspect(prospectId: string, starting: ImmortalityDevTrait): Promise<ImmortalityDevTrait> {
  return effectiveDevTrait(starting, await selfPromotionSteps(prospectId));
}

async function medalsThisSeason(prospectId: string, seasonNumber: number, throughWeek: number): Promise<TrendMedal[]> {
  const ledger = await supabase.from("rec_immortality_xp_ledger")
    .select("event_type,week")
    .eq("prospect_id", prospectId)
    .eq("season", seasonNumber)
    .in("event_type", ["weekly_gold", "weekly_silver", "weekly_bronze"]);
  if (ledger.error) throw new ApiError(500, "Could not load weekly medals.", ledger.error);
  const byWeek = new Map<number, Array<"bronze" | "silver" | "gold">>();
  for (const row of ledger.data ?? []) {
    const week = Number(row.week);
    const event = String(row.event_type);
    if (!Number.isInteger(week) || week < 1) continue;
    const tier = event === "weekly_gold" ? "gold" : event === "weekly_silver" ? "silver" : "bronze";
    const list = byWeek.get(week) ?? [];
    list.push(tier);
    byWeek.set(week, list);
  }
  const medals: TrendMedal[] = [];
  for (let week = 1; week <= throughWeek; week += 1) {
    medals.push(highestMedalForWeek(byWeek.get(week) ?? []));
  }
  return medals;
}

async function insertCommissionerRecord(input: {
  guildId: string;
  leagueId: string;
  userId: string;
  queueType: string;
  header: string;
  summary: string;
  sourceTable: string;
  sourceId: string;
  payload: Record<string, unknown>;
}) {
  const discordId = await discordIdForRecUser(input.userId).catch(() => null);
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    league_id: input.leagueId,
    queue_type: input.queueType,
    status: "pending",
    priority: 0,
    header: input.header,
    summary: input.summary,
    requester_user_id: input.userId,
    requester_discord_id: discordId,
    source_table: input.sourceTable,
    source_id: input.sourceId,
    payload: input.payload,
  }).select("id").single();
  if (inbox.error) throw new ApiError(500, "Saved, but the commissioner record failed — tell your commissioner directly.", inbox.error);
  await notifyLeagueCommissionersOfPendingItem(input.leagueId);
  return String(inbox.data.id);
}

export async function getProgressionState(input: { guildId: string; discordId: string; side: "offense" | "defense" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const { catalog, traits, ownedKeys, selected, modifiers } = await modifiersAndCatalog(prospect);
  const playerXp = await playerXpFor(prospect.id);
  const starting = startingDevTrait(modifiers);
  const currentDevTrait = await recDevTraitForProspect(prospect.id, starting);
  const recLeague = await supabase.from("rec_leagues").select("season_number,current_week").eq("id", context.leagueId).maybeSingle();
  const seasonNumber = Number(recLeague.data?.season_number ?? 1);
  const weekNumber = Math.max(0, Number(recLeague.data?.current_week ?? 1) - 1);
  const medals = weekNumber > 0 ? await medalsThisSeason(String(prospect.id), seasonNumber, weekNumber) : [];
  const trend = evaluateSeasonTrend({
    currentDevTrait,
    medals,
    promotionCheckBonus: modifiers.promotionCheckBonus,
  });
  const nodes = catalog.filter((item) => item.tier >= 2).map((item) => {
    const owned = ownedKeys.includes(item.key);
    const check = owned
      ? { ok: true as const, xpCost: item.xpCost, slotCost: item.slotCost }
      : purchaseCharacteristic({
        positionGroup: item.positionGroup,
        catalog,
        ownedKeys,
        key: item.key,
        availableXp: playerXp,
      });
    return {
      key: item.key,
      displayName: item.displayName,
      effect: item.effect,
      tier: item.tier,
      xpCost: item.xpCost,
      owned,
      source: (traits.find((row) => row.characteristic_key === item.key) as { source?: string } | undefined)?.source ?? null,
      canPurchase: check.ok && !owned,
      blockedReason: owned ? null : (check.ok ? (playerXp < item.xpCost ? `Need ${item.xpCost} Player XP.` : null) : humanPurchaseError(check.error)),
    };
  });
  const teammates = modifiers.teammateDevPurchaseUnlocked
    ? await loadTeammates(context.leagueId, String(prospect.player_id ?? ""), userId)
    : [];
  return {
    prospectId: String(prospect.id),
    name: `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect",
    position: prospect.position,
    playerXp,
    startingDevTrait: starting,
    currentDevTrait,
    nextDevTrait: promotionPath(currentDevTrait),
    selfPurchaseUnlocked: modifiers.devTraitPurchaseUnlocked,
    teammatePurchaseUnlocked: modifiers.teammateDevPurchaseUnlocked,
    selfPurchaseCost: currentDevTrait === "xfactor" ? 0 : DEV_TRAIT_PROMOTION_XP_COST[currentDevTrait],
    tradeAccess: modifiers.tradeAccess,
    trend: {
      medals,
      promote: trend.promote,
      reason: trend.reason,
      window: trend.window,
      score: trend.score,
      golds: trend.golds,
      nextDevTrait: trend.nextDevTrait,
    },
    nodes,
    teammates,
    origins: selected.filter((item) => item.tier === 1).map((item) => ({
      key: item.key,
      displayName: item.displayName,
      effect: item.effect,
    })),
  };
}

function humanPurchaseError(error: string): string {
  if (error === "tier_locked") return "Unlock the previous tree tier first.";
  if (error === "already_owned") return "Already owned.";
  if (error === "insufficient_xp") return "Not enough Player XP.";
  if (error === "origins_only") return "That perk is an Origins pick, not a tree purchase.";
  return error.replaceAll("_", " ");
}

async function loadTeammates(leagueId: string, prospectPlayerId: string, userId: string) {
  const assignment = await supabase.from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : "";
  if (!teamId) return [];
  const players = await supabase.from("rec_players")
    .select("id,full_name,position,dev_trait")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("roster_status", "active")
    .order("overall_rating", { ascending: false });
  if (players.error) throw new ApiError(500, "Could not load teammates.", players.error);
  const ids = (players.data ?? []).map((row) => String(row.id)).filter((id) => id !== prospectPlayerId);
  const promoRows = ids.length
    ? await supabase.from("rec_immortality_dev_promotions")
      .select("target_player_id,to_trait,created_at")
      .in("target_player_id", ids)
      .in("status", [...ACTIVE_PROMOTION_STATUSES])
      .order("created_at", { ascending: false })
    : { data: [] as Array<{ target_player_id: string; to_trait: string }>, error: null };
  if (promoRows.error) throw new ApiError(500, "Could not load teammate promotions.", promoRows.error);
  const latestByPlayer = new Map<string, ImmortalityDevTrait>();
  for (const row of promoRows.data ?? []) {
    const id = String(row.target_player_id);
    if (latestByPlayer.has(id)) continue;
    const trait = row.to_trait;
    if (trait === "normal" || trait === "star" || trait === "superstar" || trait === "xfactor") {
      latestByPlayer.set(id, trait);
    }
  }
  return (players.data ?? []).flatMap((row) => {
    const id = String(row.id);
    if (prospectPlayerId && id === prospectPlayerId) return [];
    const fallback = (row.dev_trait === "star" || row.dev_trait === "superstar" || row.dev_trait === "xfactor" ? row.dev_trait : "normal") as ImmortalityDevTrait;
    const currentDevTrait = latestByPlayer.get(id) ?? fallback;
    return [{
      playerId: id,
      name: String(row.full_name ?? "Teammate"),
      position: String(row.position ?? ""),
      currentDevTrait,
      nextDevTrait: promotionPath(currentDevTrait),
      cost: currentDevTrait === "xfactor" ? 0 : DEV_TRAIT_PROMOTION_XP_COST[currentDevTrait],
    }];
  });
}

export async function purchaseProgressionPerk(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  key: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const { catalog, ownedKeys } = await modifiersAndCatalog(prospect);
  const playerXp = await playerXpFor(prospect.id);
  const purchased = purchaseCharacteristic({
    positionGroup: positionGroupFor(prospect.position as ImmortalityPosition),
    catalog,
    ownedKeys,
    key: input.key,
    availableXp: playerXp,
  });
  if (!purchased.ok) throw new ApiError(400, humanPurchaseError(purchased.error));
  const definition = catalog.find((item) => item.key === input.key)!;
  const sourceId = `tree:${randomUUID()}`;
  const spent = await supabase.rpc("rec_immortality_spend_xp", {
    p_prospect_id: prospect.id,
    p_event_type: "progression_tree",
    p_source_id: sourceId,
    p_player_xp_delta: -purchased.xpCost,
    p_team_xp_delta: 0,
    p_formula_version: FORMULA_VERSIONS.xp,
  });
  if (spent.error) throw new ApiError(500, "Could not spend Player XP.", spent.error);
  if (!spent.data) throw new ApiError(400, "Not enough Player XP for that perk.");
  const inserted = await supabase.from("rec_immortality_prospect_characteristics").insert({
    prospect_id: prospect.id,
    characteristic_key: definition.key,
    slot_cost: definition.slotCost,
    xp_spent: purchased.xpCost,
    source: "progression_tree",
  }).select("id").single();
  if (inserted.error) {
    await supabase.rpc("rec_immortality_spend_xp", {
      p_prospect_id: prospect.id,
      p_event_type: "progression_tree_refund",
      p_source_id: `refund:${sourceId}`,
      p_player_xp_delta: purchased.xpCost,
      p_team_xp_delta: 0,
      p_formula_version: FORMULA_VERSIONS.xp,
    });
    throw new ApiError(500, "Could not save that Progression Tree perk.", inserted.error);
  }
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unnamed Prospect";
  const requestId = await insertCommissionerRecord({
    guildId: input.guildId,
    leagueId: context.leagueId,
    userId,
    queueType: "immortality_tree_purchase",
    header: `Progression Tree: ${name} — ${definition.displayName}`,
    summary: `Tier ${definition.tier} perk purchased for ${purchased.xpCost} Player XP (already spent). Confirm it's noted; refund if you need to reverse it.`,
    sourceTable: "rec_immortality_prospect_characteristics",
    sourceId: String(inserted.data.id),
    payload: {
      prospectId: prospect.id,
      characteristicId: inserted.data.id,
      key: definition.key,
      displayName: definition.displayName,
      tier: definition.tier,
      xpCost: purchased.xpCost,
      spendSourceId: sourceId,
      side: prospect.side,
      name,
    },
  });
  return { applied: true as const, key: definition.key, displayName: definition.displayName, xpCost: purchased.xpCost, requestId };
}

export async function resolveProgressionPerk(input: {
  guildId: string; requestId: string; action: "applied" | "refunded"; reviewerDiscordId: string; note?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const request = await supabase.from("rec_commissioners_inbox").select("*").eq("id", input.requestId).eq("league_id", context.leagueId).maybeSingle();
  if (request.error || !request.data) throw new ApiError(404, "Request not found in this league.");
  if (String(request.data.queue_type) !== "immortality_tree_purchase") throw new ApiError(400, "That request isn't a Progression Tree purchase.");
  if (request.data.status !== "pending") throw new ApiError(409, `Request is already ${request.data.status}.`);
  const payload = (request.data.payload ?? {}) as {
    prospectId: string; characteristicId: string; xpCost: number; spendSourceId: string;
  };
  if (input.action === "refunded") {
    await supabase.from("rec_immortality_prospect_characteristics").delete().eq("id", payload.characteristicId);
    const refunded = await supabase.rpc("rec_immortality_spend_xp", {
      p_prospect_id: payload.prospectId,
      p_event_type: "progression_tree_refund",
      p_source_id: `refund:${payload.spendSourceId}`,
      p_player_xp_delta: payload.xpCost,
      p_team_xp_delta: 0,
      p_formula_version: FORMULA_VERSIONS.xp,
    });
    if (refunded.error) throw new ApiError(500, "Could not refund that perk.", refunded.error);
  }
  const updated = await supabase.from("rec_commissioners_inbox").update({
    status: input.action === "applied" ? "approved" : "denied",
    reviewed_by_discord_id: input.reviewerDiscordId,
    reviewed_at: new Date().toISOString(),
    review_reason: input.note?.trim() ?? null,
  }).eq("id", input.requestId).select("*").single();
  if (updated.error) throw new ApiError(500, "Could not save that review decision.", updated.error);
  return { request: updated.data };
}

export async function purchaseDevPromotion(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  teammatePlayerId?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const { modifiers } = await modifiersAndCatalog(prospect);
  const playerXp = await playerXpFor(prospect.id);
  const recLeague = await supabase.from("rec_leagues").select("season_number").eq("id", context.leagueId).maybeSingle();
  const seasonNumber = Number(recLeague.data?.season_number ?? 1);
  const isTeammate = Boolean(input.teammatePlayerId);
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unnamed Prospect";

  let fromTrait: ImmortalityDevTrait;
  let targetName: string;
  let targetPlayerId: string | null = null;
  let purchased: ReturnType<typeof purchaseDevTraitPromotion>;

  if (isTeammate) {
    const teammates = await loadTeammates(context.leagueId, String(prospect.player_id ?? ""), userId);
    const teammate = teammates.find((row) => row.playerId === input.teammatePlayerId);
    if (!teammate) throw new ApiError(400, "That player isn't on your roster.");
    fromTrait = teammate.currentDevTrait;
    targetName = teammate.name;
    targetPlayerId = teammate.playerId;
    purchased = purchaseTeammateDevTraitPromotion({
      currentDevTrait: fromTrait,
      availableXp: playerXp,
      teammateDevPurchaseUnlocked: modifiers.teammateDevPurchaseUnlocked,
    });
  } else {
    fromTrait = await recDevTraitForProspect(String(prospect.id), startingDevTrait(modifiers));
    targetName = name;
    purchased = purchaseDevTraitPromotion({
      currentDevTrait: fromTrait,
      availableXp: playerXp,
      devTraitPurchaseUnlocked: modifiers.devTraitPurchaseUnlocked,
    });
  }
  if (!purchased.ok) throw new ApiError(400, purchased.error);

  const sourceId = `devpromo:${randomUUID()}`;
  const spent = await supabase.rpc("rec_immortality_spend_xp", {
    p_prospect_id: prospect.id,
    p_event_type: isTeammate ? "teammate_dev_promotion" : "self_dev_promotion",
    p_source_id: sourceId,
    p_player_xp_delta: -purchased.cost,
    p_team_xp_delta: 0,
    p_formula_version: FORMULA_VERSIONS.xp,
  });
  if (spent.error) throw new ApiError(500, "Could not spend Player XP.", spent.error);
  if (!spent.data) throw new ApiError(400, "Not enough Player XP for that promotion.");

  const inserted = await supabase.from("rec_immortality_dev_promotions").insert({
    immortality_league_id: league.id,
    prospect_id: prospect.id,
    target_player_id: targetPlayerId,
    target_name: targetName,
    from_trait: fromTrait,
    to_trait: purchased.nextDevTrait,
    source: isTeammate ? "teammate_purchase" : "self_purchase",
    season_number: seasonNumber,
    xp_spent: purchased.cost,
    status: "pending",
  }).select("id").single();
  if (inserted.error) {
    await supabase.rpc("rec_immortality_spend_xp", {
      p_prospect_id: prospect.id,
      p_event_type: isTeammate ? "teammate_dev_promotion_refund" : "self_dev_promotion_refund",
      p_source_id: `refund:${sourceId}`,
      p_player_xp_delta: purchased.cost,
      p_team_xp_delta: 0,
      p_formula_version: FORMULA_VERSIONS.xp,
    });
    throw new ApiError(500, "Could not record that promotion.", inserted.error);
  }

  const requestId = await insertCommissionerRecord({
    guildId: input.guildId,
    leagueId: context.leagueId,
    userId,
    queueType: "immortality_dev_promotion",
    header: `Dev trait: ${targetName} ${fromTrait} → ${purchased.nextDevTrait}`,
    summary: `${purchased.cost} Player XP already spent. Set this development trait in your Madden save, then mark Applied in game.`,
    sourceTable: "rec_immortality_dev_promotions",
    sourceId: String(inserted.data.id),
    payload: {
      promotionId: inserted.data.id,
      prospectId: prospect.id,
      targetPlayerId,
      targetName,
      fromTrait,
      toTrait: purchased.nextDevTrait,
      xpCost: purchased.cost,
      spendSourceId: sourceId,
      source: isTeammate ? "teammate_purchase" : "self_purchase",
      side: prospect.side,
    },
  });
  return {
    applied: true as const,
    fromTrait,
    toTrait: purchased.nextDevTrait,
    xpCost: purchased.cost,
    targetName,
    requestId,
  };
}

export async function resolveDevPromotion(input: {
  guildId: string; requestId: string; action: "applied" | "refunded"; reviewerDiscordId: string; note?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const request = await supabase.from("rec_commissioners_inbox").select("*").eq("id", input.requestId).eq("league_id", context.leagueId).maybeSingle();
  if (request.error || !request.data) throw new ApiError(404, "Request not found in this league.");
  if (String(request.data.queue_type) !== "immortality_dev_promotion") throw new ApiError(400, "That request isn't a development-trait promotion.");
  if (request.data.status !== "pending") throw new ApiError(409, `Request is already ${request.data.status}.`);
  const payload = (request.data.payload ?? {}) as {
    promotionId: string; prospectId: string; xpCost: number; spendSourceId: string; source: string;
  };
  if (input.action === "refunded") {
    await supabase.from("rec_immortality_dev_promotions")
      .update({ status: "refunded", resolved_at: new Date().toISOString() })
      .eq("id", payload.promotionId);
    if (payload.xpCost > 0) {
      const refunded = await supabase.rpc("rec_immortality_spend_xp", {
        p_prospect_id: payload.prospectId,
        p_event_type: payload.source === "teammate_purchase" ? "teammate_dev_promotion_refund" : payload.source === "season_trend" ? "season_trend_promotion_refund" : "self_dev_promotion_refund",
        p_source_id: `refund:${payload.spendSourceId}`,
        p_player_xp_delta: payload.xpCost,
        p_team_xp_delta: 0,
        p_formula_version: FORMULA_VERSIONS.xp,
      });
      if (refunded.error) throw new ApiError(500, "Could not refund that promotion.", refunded.error);
    }
  } else {
    await supabase.from("rec_immortality_dev_promotions")
      .update({ status: "applied", resolved_at: new Date().toISOString() })
      .eq("id", payload.promotionId);
  }
  const updated = await supabase.from("rec_commissioners_inbox").update({
    status: input.action === "applied" ? "approved" : "denied",
    reviewed_by_discord_id: input.reviewerDiscordId,
    reviewed_at: new Date().toISOString(),
    review_reason: input.note?.trim() ?? null,
  }).eq("id", input.requestId).select("*").single();
  if (updated.error) throw new ApiError(500, "Could not save that review decision.", updated.error);
  return { request: updated.data };
}

export async function evaluateSeasonTrendPromotionsAfterAdvance(input: {
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
}): Promise<void> {
  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return;
  const routes = await findServerRoutesForLeague(input.leagueId);
  const guildId = routes?.guildId;
  if (!guildId) return;
  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,user_id,position,first_name,last_name,player_id,side")
    .eq("immortality_league_id", immortality.id);
  for (const prospect of prospects.data ?? []) {
    if (!prospect.player_id) continue;
    const { modifiers } = await modifiersAndCatalog({ id: String(prospect.id), position: String(prospect.position) });
    const currentDevTrait = await recDevTraitForProspect(String(prospect.id), startingDevTrait(modifiers));
    const medals = await medalsThisSeason(String(prospect.id), input.seasonNumber, input.weekNumber);
    const trend = evaluateSeasonTrend({
      currentDevTrait,
      medals,
      promotionCheckBonus: modifiers.promotionCheckBonus,
    });
    if (!trend.promote) continue;
    const inserted = await supabase.from("rec_immortality_dev_promotions").insert({
      immortality_league_id: immortality.id,
      prospect_id: prospect.id,
      target_player_id: null,
      target_name: `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect",
      from_trait: currentDevTrait,
      to_trait: trend.nextDevTrait,
      source: "season_trend",
      season_number: input.seasonNumber,
      xp_spent: 0,
      status: "pending",
    }).select("id").maybeSingle();
    if (inserted.error) {
      if (inserted.error.code === "23505") continue;
      console.error(`[ERROR] Could not record season-trend promotion for ${prospect.id}:`, inserted.error);
      continue;
    }
    if (!inserted.data) continue;
    const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect";
    try {
      await insertCommissionerRecord({
        guildId,
        leagueId: input.leagueId,
        userId: String(prospect.user_id),
        queueType: "immortality_dev_promotion",
        header: `Season trend: ${name} ${currentDevTrait} → ${trend.nextDevTrait}`,
        summary: `${trend.reason} Set this development trait in your Madden save, then mark Applied in game. No Player XP was spent.`,
        sourceTable: "rec_immortality_dev_promotions",
        sourceId: String(inserted.data.id),
        payload: {
          promotionId: inserted.data.id,
          prospectId: prospect.id,
          targetPlayerId: null,
          targetName: name,
          fromTrait: currentDevTrait,
          toTrait: trend.nextDevTrait,
          xpCost: 0,
          spendSourceId: `trend:${input.seasonNumber}:${prospect.id}`,
          source: "season_trend",
          side: prospect.side,
        },
      });
    } catch (error) {
      console.error(`[ERROR] Could not inbox season-trend promotion for ${prospect.id}:`, error);
    }
  }
}
