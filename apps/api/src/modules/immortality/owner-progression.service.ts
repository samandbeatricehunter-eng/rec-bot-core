/**
 * Rise to Immortality Pass 7 (Owner Tree / Franchise Pillar). Parallel to (but independent from)
 * progression.service.ts's prospect Player-XP tree: owners spend their own Owner XP ledger on the
 * "OWNER" characteristics catalog via the exact same characteristicCatalog/purchaseCharacteristic/
 * combinedModifiers engine prospects use (see characteristics_OWNER.json), just keyed by
 * rec_immortality_owners.id instead of a prospect id.
 *
 * Owner XP pacing (this pass's own calibration, first-pass numbers like every other unreleased
 * threshold in this system): a win is worth OWNER_WIN_XP, finishing a season is worth
 * OWNER_SEASON_COMPLETION_XP once. An average ~8-9 win team nets roughly one Tier-2 node (50 XP)
 * per season and finishes the whole tree (3 lanes + capstone, 540 XP total) in the neighborhood of
 * the Pass 11 seven-season simulation horizon -- faster for a winning franchise, slower for a
 * losing one. Retune here if real usage shows it's off.
 */
import { randomUUID } from "node:crypto";
import {
  characteristicCatalog,
  combinedModifiers,
  FORMULA_VERSIONS,
  purchaseCharacteristic,
  type CharacteristicDefinition,
  type CharacteristicModifiers,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { discordIdForRecUser, loadImmortalityLeague, recUserIdFromDiscordId, requireImmortalityLeague } from "./immortality.service.js";

export const OWNER_WIN_XP = 4;
export const OWNER_SEASON_COMPLETION_XP = 15;
/** Flat "invest now, mature one season later" rate -- no investment-type catalog yet (see
 * characteristics_OWNER.json's Organizational Influence lane doc comment). */
export const FRANCHISE_INVESTMENT_BASE_ROI = 0.30;

const OWNER_GROUP = "OWNER" as const;

async function loadOwnerRow(immortalityLeagueId: string, userId: string) {
  const row = await supabase.from("rec_immortality_owners").select("*")
    .eq("immortality_league_id", immortalityLeagueId).eq("user_id", userId).maybeSingle();
  if (row.error) throw new ApiError(500, "Could not load your owner profile.", row.error);
  return row.data;
}

async function ownerModifiersAndCatalog(ownerId: string) {
  const catalog = characteristicCatalog(OWNER_GROUP);
  const traits = await supabase.from("rec_immortality_owner_progression")
    .select("characteristic_key,source,xp_spent").eq("owner_id", ownerId);
  if (traits.error) throw new ApiError(500, "Could not load Franchise Pillar perks.", traits.error);
  const ownedKeys = (traits.data ?? []).map((row) => String(row.characteristic_key));
  const selected = catalog.filter((item) => ownedKeys.includes(item.key));
  return { catalog, traits: traits.data ?? [], ownedKeys, selected, modifiers: combinedModifiers(selected) };
}

async function ownerXpFor(ownerId: string): Promise<number> {
  const ledger = await supabase.from("rec_immortality_owner_xp_ledger").select("xp_delta").eq("owner_id", ownerId);
  if (ledger.error) throw new ApiError(500, "Could not load Owner XP.", ledger.error);
  return (ledger.data ?? []).reduce((sum, row) => sum + Number(row.xp_delta ?? 0), 0);
}

async function insertCommissionerRecord(input: {
  guildId: string; leagueId: string; userId: string; queueType: string; header: string; summary: string;
  sourceTable: string; sourceId: string; payload: Record<string, unknown>;
}) {
  const discordId = await discordIdForRecUser(input.userId).catch(() => null);
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, league_id: input.leagueId, queue_type: input.queueType, status: "pending", priority: 0,
    header: input.header, summary: input.summary, requester_user_id: input.userId, requester_discord_id: discordId,
    source_table: input.sourceTable, source_id: input.sourceId, payload: input.payload,
  }).select("id").single();
  if (inbox.error) throw new ApiError(500, "Saved, but the commissioner record failed — tell your commissioner directly.", inbox.error);
  await notifyLeagueCommissionersOfPendingItem(input.leagueId);
  return String(inbox.data.id);
}

export async function getOwnerProgressionState(input: { guildId: string; discordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const owner = await loadOwnerRow(league.id, userId);
  if (!owner) throw new ApiError(400, "Owner profile not found.");
  const { catalog, traits, ownedKeys, selected, modifiers } = await ownerModifiersAndCatalog(owner.id);
  const ownerXp = await ownerXpFor(owner.id);

  const nodes = catalog.map((item) => {
    const owned = ownedKeys.includes(item.key);
    const check = owned
      ? { ok: true as const, xpCost: item.xpCost, slotCost: item.slotCost }
      : purchaseCharacteristic({ positionGroup: OWNER_GROUP, catalog, ownedKeys, key: item.key, availableXp: ownerXp });
    return {
      key: item.key, displayName: item.displayName, effect: item.effect, tier: item.tier, xpCost: item.xpCost,
      owned, branch: item.branch ?? null, requires: item.requires ?? [],
      source: (traits.find((row) => row.characteristic_key === item.key) as { source?: string } | undefined)?.source ?? null,
      canPurchase: check.ok && !owned,
      blockedReason: owned ? null : (check.ok ? (ownerXp < item.xpCost ? `Need ${item.xpCost} Owner XP.` : null) : humanOwnerPurchaseError(check, catalog)),
    };
  });

  const investments = await supabase.from("rec_immortality_franchise_investments")
    .select("id,xp_invested,invested_season_number,matures_season_number,roi_rate,status")
    .eq("owner_id", owner.id).order("created_at", { ascending: false });

  let abilityCoachUsedThisSeason = false;
  const eligibleAbilityCoachTargets: Array<{ prospectId: string; name: string; devTrait: string }> = [];
  if (modifiers.masterAbilityCoachUnlocked) {
    const recLeague = await supabase.from("rec_leagues").select("season_number").eq("id", context.leagueId).maybeSingle();
    const seasonNumber = Number(recLeague.data?.season_number ?? 1);
    const already = await supabase.from("rec_immortality_ability_grants").select("id")
      .eq("event_type", "owner_mastery_grant").eq("source_id", `owner_mastery:${owner.id}:${seasonNumber}`).limit(1);
    abilityCoachUsedThisSeason = Boolean(already.data?.length);
    const assignment = await supabase.from("rec_team_assignments").select("team_id")
      .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
    const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
    if (teamId && !abilityCoachUsedThisSeason) {
      const prospects = await supabase.from("rec_immortality_prospects")
        .select("id,first_name,last_name,player_id").eq("immortality_league_id", league.id).not("player_id", "is", null);
      for (const prospect of prospects.data ?? []) {
        const player = await supabase.from("rec_players").select("team_id,dev_trait").eq("id", prospect.player_id).maybeSingle();
        if (!player.data || String(player.data.team_id) !== teamId) continue;
        const promo = await supabase.from("rec_immortality_dev_promotions").select("to_trait")
          .eq("target_player_id", prospect.player_id).in("status", ["pending", "applied"])
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const devTrait = (promo.data?.to_trait as string | undefined) ?? String(player.data.dev_trait ?? "normal");
        if (devTrait === "superstar" || devTrait === "xfactor") {
          eligibleAbilityCoachTargets.push({
            prospectId: String(prospect.id),
            name: `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect",
            devTrait,
          });
        }
      }
    }
  }

  return {
    ownerId: String(owner.id),
    name: `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim() || "Owner",
    ownerXp,
    personnelCouncilTier: modifiers.personnelCouncilTier,
    releaseAuthorityUnlocked: modifiers.releaseAuthorityUnlocked,
    franchiseInvestmentsUnlocked: modifiers.franchiseInvestmentsUnlocked,
    investmentRoiBonus: modifiers.investmentRoiBonus,
    teammatePromotionDiscountRate: modifiers.teammatePromotionDiscountRate,
    masterAbilityCoachUnlocked: modifiers.masterAbilityCoachUnlocked,
    abilityCoachUsedThisSeason,
    eligibleAbilityCoachTargets,
    nodes,
    investments: (investments.data ?? []).map((row) => ({
      id: String(row.id), xpInvested: Number(row.xp_invested), investedSeasonNumber: Number(row.invested_season_number),
      maturesSeasonNumber: Number(row.matures_season_number), roiRate: Number(row.roi_rate), status: row.status as "active" | "matured",
    })),
  };
}

function humanOwnerPurchaseError(check: { error: string; missingKeys?: string[] }, catalog: CharacteristicDefinition[]): string {
  if (check.error === "prerequisite_locked") {
    const names = (check.missingKeys ?? []).map((key) => catalog.find((item) => item.key === key)?.displayName ?? key);
    return names.length ? `Requires: ${names.join(", ")}.` : "Missing a required perk.";
  }
  if (check.error === "already_owned") return "Already owned.";
  if (check.error === "insufficient_xp") return "Not enough Owner XP.";
  return check.error.replaceAll("_", " ");
}

export async function purchaseOwnerPerk(input: { guildId: string; discordId: string; key: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const owner = await loadOwnerRow(league.id, userId);
  if (!owner) throw new ApiError(400, "Owner profile not found.");
  const { catalog, ownedKeys } = await ownerModifiersAndCatalog(owner.id);
  const ownerXp = await ownerXpFor(owner.id);
  const purchased = purchaseCharacteristic({ positionGroup: OWNER_GROUP, catalog, ownedKeys, key: input.key, availableXp: ownerXp });
  if (!purchased.ok) throw new ApiError(400, humanOwnerPurchaseError(purchased, catalog));
  const definition = catalog.find((item) => item.key === input.key)!;
  const sourceId = `tree:${randomUUID()}`;
  const spent = await supabase.rpc("rec_immortality_spend_owner_xp", {
    p_owner_id: owner.id, p_event_type: "progression_tree", p_source_id: sourceId,
    p_xp_delta: -purchased.xpCost, p_formula_version: FORMULA_VERSIONS.characteristics,
  });
  if (spent.error) throw new ApiError(500, "Could not spend Owner XP.", spent.error);
  if (!spent.data) throw new ApiError(400, "Not enough Owner XP for that perk.");
  const inserted = await supabase.from("rec_immortality_owner_progression").insert({
    owner_id: owner.id, characteristic_key: definition.key, slot_cost: definition.slotCost,
    xp_spent: purchased.xpCost, source: "progression_tree",
  }).select("id").single();
  if (inserted.error) {
    await supabase.rpc("rec_immortality_spend_owner_xp", {
      p_owner_id: owner.id, p_event_type: "progression_tree_refund", p_source_id: `refund:${sourceId}`,
      p_xp_delta: purchased.xpCost, p_formula_version: FORMULA_VERSIONS.characteristics,
    });
    throw new ApiError(500, "Could not save that Franchise Pillar perk.", inserted.error);
  }
  const name = `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim() || "Unnamed Owner";
  const requestId = await insertCommissionerRecord({
    guildId: input.guildId, leagueId: context.leagueId, userId, queueType: "immortality_owner_tree_purchase",
    header: `Franchise Pillar: ${name} — ${definition.displayName}`,
    summary: `Tier ${definition.tier} perk purchased for ${purchased.xpCost} Owner XP (already spent). Confirm it's noted; refund if you need to reverse it.`,
    sourceTable: "rec_immortality_owner_progression", sourceId: String(inserted.data.id),
    payload: { ownerId: owner.id, characteristicId: inserted.data.id, key: definition.key, displayName: definition.displayName, tier: definition.tier, xpCost: purchased.xpCost, spendSourceId: sourceId, name },
  });
  return { applied: true as const, key: definition.key, displayName: definition.displayName, xpCost: purchased.xpCost, requestId };
}

export async function resolveOwnerPerk(input: { guildId: string; requestId: string; action: "applied" | "refunded"; reviewerDiscordId: string; note?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const request = await supabase.from("rec_commissioners_inbox").select("*").eq("id", input.requestId).eq("league_id", context.leagueId).maybeSingle();
  if (request.error || !request.data) throw new ApiError(404, "Request not found in this league.");
  if (String(request.data.queue_type) !== "immortality_owner_tree_purchase") throw new ApiError(400, "That request isn't a Franchise Pillar purchase.");
  if (request.data.status !== "pending") throw new ApiError(409, `Request is already ${request.data.status}.`);
  const payload = (request.data.payload ?? {}) as { ownerId: string; characteristicId: string; xpCost: number; spendSourceId: string };
  if (input.action === "refunded") {
    await supabase.from("rec_immortality_owner_progression").delete().eq("id", payload.characteristicId);
    const refunded = await supabase.rpc("rec_immortality_spend_owner_xp", {
      p_owner_id: payload.ownerId, p_event_type: "progression_tree_refund", p_source_id: `refund:${payload.spendSourceId}`,
      p_xp_delta: payload.xpCost, p_formula_version: FORMULA_VERSIONS.characteristics,
    });
    if (refunded.error) throw new ApiError(500, "Could not refund that perk.", refunded.error);
  }
  const updated = await supabase.from("rec_commissioners_inbox").update({
    status: input.action === "applied" ? "approved" : "denied", reviewed_by_discord_id: input.reviewerDiscordId,
    reviewed_at: new Date().toISOString(), review_reason: input.note?.trim() ?? null,
  }).eq("id", input.requestId).select("*").single();
  if (updated.error) throw new ApiError(500, "Could not save that review decision.", updated.error);
  return { request: updated.data };
}

export async function investFranchiseXp(input: { guildId: string; discordId: string; amount: number }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new ApiError(400, "Investment amount must be a positive whole number.");
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const owner = await loadOwnerRow(league.id, userId);
  if (!owner) throw new ApiError(400, "Owner profile not found.");
  const { modifiers } = await ownerModifiersAndCatalog(owner.id);
  if (!modifiers.franchiseInvestmentsUnlocked) throw new ApiError(400, "Purchase Investment Office (Organizational Influence, Tier 2) before investing.");
  const ownerXp = await ownerXpFor(owner.id);
  if (ownerXp < input.amount) throw new ApiError(400, `Need ${input.amount} Owner XP.`);
  const recLeague = await supabase.from("rec_leagues").select("season_number").eq("id", context.leagueId).maybeSingle();
  const seasonNumber = Number(recLeague.data?.season_number ?? 1);
  const sourceId = `invest:${randomUUID()}`;
  const spent = await supabase.rpc("rec_immortality_spend_owner_xp", {
    p_owner_id: owner.id, p_event_type: "franchise_investment", p_source_id: sourceId,
    p_xp_delta: -input.amount, p_formula_version: FORMULA_VERSIONS.characteristics, p_season_number: seasonNumber,
  });
  if (spent.error) throw new ApiError(500, "Could not spend Owner XP.", spent.error);
  if (!spent.data) throw new ApiError(400, "Not enough Owner XP for that investment.");
  const roiRate = FRANCHISE_INVESTMENT_BASE_ROI + modifiers.investmentRoiBonus;
  const inserted = await supabase.from("rec_immortality_franchise_investments").insert({
    owner_id: owner.id, immortality_league_id: league.id, xp_invested: input.amount,
    invested_season_number: seasonNumber, matures_season_number: seasonNumber + 1, roi_rate: roiRate,
  }).select("id").single();
  if (inserted.error) {
    await supabase.rpc("rec_immortality_spend_owner_xp", {
      p_owner_id: owner.id, p_event_type: "franchise_investment_refund", p_source_id: `refund:${sourceId}`,
      p_xp_delta: input.amount, p_formula_version: FORMULA_VERSIONS.characteristics,
    });
    throw new ApiError(500, "Could not save that investment.", inserted.error);
  }
  return { invested: input.amount, maturesSeasonNumber: seasonNumber + 1, roiRate };
}

/** Called once per advance (see xp-awards.service.ts's awardImmortalityChallengesAfterAdvance) --
 * credits every investment whose matures_season_number has arrived. Idempotent via the ledger's
 * (owner_id, event_type, source_id) unique constraint, so re-running for an already-credited
 * investment is a safe no-op even if this fires more than once for the same season transition. */
export async function resolveMaturedFranchiseInvestments(immortalityLeagueId: string, seasonNumber: number): Promise<void> {
  const matured = await supabase.from("rec_immortality_franchise_investments")
    .select("id,owner_id,xp_invested,roi_rate")
    .eq("immortality_league_id", immortalityLeagueId).eq("status", "active").lte("matures_season_number", seasonNumber);
  if (matured.error || !matured.data?.length) return;
  for (const row of matured.data) {
    const payout = Math.round(Number(row.xp_invested) * (1 + Number(row.roi_rate)));
    const credited = await supabase.rpc("rec_immortality_spend_owner_xp", {
      p_owner_id: row.owner_id, p_event_type: "franchise_investment_matured", p_source_id: `matured:${row.id}`,
      p_xp_delta: payout, p_formula_version: FORMULA_VERSIONS.characteristics, p_season_number: seasonNumber,
    });
    if (credited.error) {
      console.error(`[ERROR] Could not credit matured franchise investment ${row.id} (non-fatal):`, credited.error);
      continue;
    }
    await supabase.from("rec_immortality_franchise_investments").update({ status: "matured", matured_at: new Date().toISOString() }).eq("id", row.id);
  }
}

/** Resolves the modifiers of whichever owner is currently assigned to `teamId` (via
 * rec_team_assignments -> rec_immortality_owners by user_id), or empty/zeroed modifiers if the
 * team has no claimed owner yet (e.g. still CPU-controlled or unclaimed) -- used by
 * trades.service.ts (Personnel Council tier) and roster-movement.service.ts (release authority
 * compliance flagging), both of which need a safe default when there's no owner to check. */
export async function ownerAuthorityForTeam(leagueId: string, teamId: string): Promise<CharacteristicModifiers | null> {
  const immortality = await loadImmortalityLeague(leagueId);
  if (!immortality) return null;
  const assignment = await supabase.from("rec_team_assignments").select("user_id")
    .eq("league_id", leagueId).eq("team_id", teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment.data?.user_id) return null;
  const owner = await loadOwnerRow(immortality.id, String(assignment.data.user_id));
  if (!owner) return null;
  const { modifiers } = await ownerModifiersAndCatalog(owner.id);
  return modifiers;
}

export async function ownerTradePolicyTierForTeam(leagueId: string, teamId: string): Promise<number> {
  const modifiers = await ownerAuthorityForTeam(leagueId, teamId);
  return modifiers?.personnelCouncilTier ?? 0;
}

/** Called once per advance, league-wide -- awards each owner Owner XP for their team's result
 * that week (a flat OWNER_WIN_XP per win; no playoff-berth/championship bonuses yet, since those
 * need real playoff-bracket integration this pass doesn't scope -- a clean Pass 9 addition), plus
 * a one-time OWNER_SEASON_COMPLETION_XP the moment week 1 of a NEW season is graded (detecting
 * that the previous season fully wrapped, since there's no other per-owner "season just ended"
 * signal to hook). Also resolves any matured Franchise Investments for the league's owners. */
export async function awardOwnerXpForWeek(input: { leagueId: string; immortalityLeagueId: string; seasonNumber: number; weekNumber: number }): Promise<void> {
  const owners = await supabase.from("rec_immortality_owners").select("id,user_id").eq("immortality_league_id", input.immortalityLeagueId);
  if (owners.error || !owners.data?.length) return;

  const seasonId = await resolveSeasonId(input.leagueId, input.seasonNumber).catch(() => null);

  for (const owner of owners.data) {
    const assignment = await supabase.from("rec_team_assignments").select("team_id")
      .eq("league_id", input.leagueId).eq("user_id", owner.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
    const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;

    if (teamId && seasonId) {
      const game = await supabase.from("rec_games").select("home_team_id,away_team_id,home_score,away_score,status")
        .eq("season_id", seasonId).eq("week_number", input.weekNumber).eq("status", "completed")
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`).maybeSingle();
      if (game.data && game.data.home_score != null && game.data.away_score != null) {
        const iAmHome = String(game.data.home_team_id) === teamId;
        const won = iAmHome ? Number(game.data.home_score) > Number(game.data.away_score) : Number(game.data.away_score) > Number(game.data.home_score);
        if (won) {
          await supabase.rpc("rec_immortality_spend_owner_xp", {
            p_owner_id: owner.id, p_event_type: "season_win", p_source_id: `${input.seasonNumber}:${input.weekNumber}`,
            p_xp_delta: OWNER_WIN_XP, p_formula_version: FORMULA_VERSIONS.characteristics,
            p_season_number: input.seasonNumber, p_week_number: input.weekNumber,
          }).then(({ error }) => { if (error) console.error(`[ERROR] Could not award win Owner XP for owner ${owner.id} (non-fatal):`, error); });
        }
      }
    }

    if (input.weekNumber === 1 && input.seasonNumber > 1) {
      // Culture Builder (Pass 9) adds its bonus on top of the base amount specifically -- not
      // every Owner XP source, unlike the capstone's general xpEarnBonus.
      const { modifiers } = await ownerModifiersAndCatalog(owner.id);
      const seasonCompletionXp = Math.round(OWNER_SEASON_COMPLETION_XP * (1 + modifiers.ownerSeasonCompletionBonusPct));
      await supabase.rpc("rec_immortality_spend_owner_xp", {
        p_owner_id: owner.id, p_event_type: "season_completion", p_source_id: `${input.seasonNumber - 1}`,
        p_xp_delta: seasonCompletionXp, p_formula_version: FORMULA_VERSIONS.characteristics,
        p_season_number: input.seasonNumber - 1,
      }).then(({ error }) => { if (error) console.error(`[ERROR] Could not award season-completion Owner XP for owner ${owner.id} (non-fatal):`, error); });
    }
  }

  await resolveMaturedFranchiseInvestments(input.immortalityLeagueId, input.seasonNumber);
}

/** Master Ability Coach (Pass 9): once per season, an owner who's bought it can grant one bonus
 * ability slot to a Superstar/X-Factor prospect on their own team -- reuses the same idempotent
 * rec_immortality_ability_grants ledger every other slot source (weekly/season/career/POTW/dev
 * promotion) already writes to, via the exact same grantAbilitySlot helper, rather than a new
 * mechanism. The once-per-season limit is enforced by checking for an existing grant row with
 * this owner+season's sourceId across any prospect (soft app-level check, same class of guard
 * used elsewhere in this codebase -- not airtight against a true race, but low-stakes here). */
export async function grantOwnerAbilitySlotMastery(input: { guildId: string; discordId: string; prospectId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const owner = await loadOwnerRow(league.id, userId);
  if (!owner) throw new ApiError(400, "Owner profile not found.");
  const { modifiers } = await ownerModifiersAndCatalog(owner.id);
  if (!modifiers.masterAbilityCoachUnlocked) throw new ApiError(400, "Purchase Master Ability Coach on the Franchise Pillar tree first.");

  const recLeague = await supabase.from("rec_leagues").select("season_number").eq("id", context.leagueId).maybeSingle();
  const seasonNumber = Number(recLeague.data?.season_number ?? 1);
  const sourceId = `owner_mastery:${owner.id}:${seasonNumber}`;
  const already = await supabase.from("rec_immortality_ability_grants").select("id").eq("event_type", "owner_mastery_grant").eq("source_id", sourceId).limit(1);
  if (already.error) throw new ApiError(500, "Could not check this season's Master Ability Coach usage.", already.error);
  if (already.data?.length) throw new ApiError(400, "You've already used Master Ability Coach's grant this season.");

  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
  if (!teamId) throw new ApiError(400, "You don't have a team assigned.");

  const prospect = await supabase.from("rec_immortality_prospects").select("id,player_id,first_name,last_name")
    .eq("id", input.prospectId).eq("immortality_league_id", league.id).maybeSingle();
  if (!prospect.data?.player_id) throw new ApiError(404, "Prospect not found.");
  const player = await supabase.from("rec_players").select("team_id,dev_trait").eq("id", prospect.data.player_id).maybeSingle();
  if (!player.data || String(player.data.team_id) !== teamId) throw new ApiError(400, "That prospect isn't on your team.");

  const promo = await supabase.from("rec_immortality_dev_promotions").select("to_trait")
    .eq("target_player_id", prospect.data.player_id).in("status", ["pending", "applied"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const currentDevTrait = (promo.data?.to_trait as string | undefined) ?? String(player.data.dev_trait ?? "normal");
  if (currentDevTrait !== "superstar" && currentDevTrait !== "xfactor") {
    throw new ApiError(400, "Only a Superstar or X-Factor prospect is eligible for this grant.");
  }

  const { grantAbilitySlot } = await import("./xp-awards.service.js");
  const granted = await grantAbilitySlot({ prospectId: String(prospect.data.id), eventType: "owner_mastery_grant", sourceId });
  if (!granted.granted) throw new ApiError(400, "Could not grant that slot.");
  const name = `${prospect.data.first_name ?? ""} ${prospect.data.last_name ?? ""}`.trim() || "Prospect";
  return { granted: true as const, prospectName: name };
}
