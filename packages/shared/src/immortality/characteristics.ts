import { FORMULA_VERSIONS, type ImmortalityPositionGroup } from "./types.js";

/** Origins picks are capped by count now, not by summed slot cost -- a prospect equips at most
 * this many Natural Characteristics total, and two that discount the same attribute code can
 * never both be equipped (see attributeCodesFor/validateCharacteristicSelection) rather than
 * stacking with diminishing returns. */
export const MAX_EQUIPPED_CHARACTERISTICS = 3;
export const MAX_ATTRIBUTE_DISCOUNT = 0.3;
export const SECOND_OVERLAP_EFFECTIVENESS = 0.5;
export const THIRD_OVERLAP_EFFECTIVENESS = 0.25;

export type CharacteristicTier = 1 | 2 | 3 | 4;

export const DEFAULT_XP_COST_BY_SLOT: Record<number, number> = { 1: 15, 2: 25, 3: 40 };
export const ALL_ATTRIBUTES_DISCOUNT_CODE = "ALL";

export type CharacteristicModifiers = {
  creationDiscounts: Record<string, number>;
  xpDiscounts: Record<string, number>;
  xpEarnBonus: number;
  promotionCheckBonus: number;
  teamXpFromSeason1: boolean;
  negotiatorMultiplier: number;
  knownCommodityFloor: boolean;
  startDevStar: boolean;
  /** Completing at least 2 of the week's 3 weekly challenges gives this % bonus (additive with
   * the universal Weekly Sweep bonus, applied to the same completed-challenge point total) --
   * see WEEKLY_SWEEP_BONUS_PCT in xp.ts and awardImmortalityChallengesAfterAdvance. */
  competitiveDriveBonusPct: number;
  devTraitPurchaseUnlocked: boolean;
  teammateDevPurchaseUnlocked: boolean;
  tradeAccess: boolean;
  /** Pass 7 (Owner Tree / Franchise Pillar), Personnel Authority lane -- 0 = no CPU-trade
   * access, 1 = Front Office Access (restricted CPU trading), 2 = Personnel Council (full CPU
   * trading). Owner-scoped only; a prospect's own catalog never sets this. Combined as a max,
   * not a sum -- see combinedModifiers. */
  personnelCouncilTier: number;
  /** Pass 7: Front Office Access also grants standing authority to release (cut) players --
   * distinct from trade tier because a front office can clean up a bench before it's trusted
   * with league-wide trades. Owner-scoped only. */
  releaseAuthorityUnlocked: boolean;
  /** Pass 7, Organizational Influence lane: unlocks Franchise Investments (see
   * owner-progression.service.ts) and bonus-stacks the ROI multiplier those investments mature
   * at. Owner-scoped only. */
  franchiseInvestmentsUnlocked: boolean;
  investmentRoiBonus: number;
  /** Pass 7, Player Development lane: discounts a teammate dev-trait promotion's Player XP cost
   * (see purchaseTeammateDevTraitPromotion in xp.ts). Owner-scoped only; combined as a max, not
   * a sum, since Elite Development Pipeline supersedes Development Program rather than stacking
   * with it. */
  teammatePromotionDiscountRate: number;
};

/** Rise to Immortality Pass 5 (Progression Engine V2): one variant per existing
 * CharacteristicModifiers field. A definition that declares an explicit `effects` array is
 * folded through applyEffect() instead of the legacy name-matched switch in
 * modifiersFromDefinition -- see that function's doc comment. `attribute` on the two discount
 * variants is either a real attribute code or ALL_ATTRIBUTES_DISCOUNT_CODE ("ALL"). */
export type EffectSpec =
  | { type: "attribute_creation_discount"; attribute: string; rate: number }
  | { type: "attribute_xp_discount"; attribute: string; rate: number }
  | { type: "xp_earn_bonus"; value: number }
  | { type: "promotion_check_bonus"; value: number }
  | { type: "team_xp_from_season_1" }
  | { type: "negotiator_multiplier"; value: number }
  | { type: "known_commodity_floor" }
  | { type: "start_dev_star" }
  | { type: "competitive_drive_bonus_pct"; value: number }
  | { type: "dev_trait_purchase_unlocked" }
  | { type: "teammate_dev_purchase_unlocked" }
  | { type: "trade_access" }
  | { type: "personnel_council_tier"; value: number }
  | { type: "release_authority_unlocked" }
  | { type: "franchise_investments_unlocked" }
  | { type: "investment_roi_bonus"; value: number }
  | { type: "teammate_promotion_discount"; rate: number };

export type CharacteristicDefinition = {
  key: string;
  displayName: string;
  positionGroup: ImmortalityPositionGroup;
  slotCost: number;
  effect: string;
  tags: string[];
  modifiers: CharacteristicModifiers;
  configurationVersion: typeof FORMULA_VERSIONS.characteristics;
  tier: CharacteristicTier;
  xpCost: number;
  /** Pass 5: specific prerequisite catalog keys (AND -- all must be owned), authored per-node
   * for a real lane chain. `undefined` (every node in the 5 original catalogs) falls back to the
   * original flat tier-count rule unchanged -- see purchaseCharacteristic's doc comment. An
   * empty array (Pass 7's lane-opener Owner nodes, which have no prerequisite at all but still
   * need to skip the flat tier-count rule since Owner has no Tier-1 Origins content) means
   * "gated by XP only." Pass 6/7 populate this when authoring QB/MIKE/Owner lanes. */
  requires?: string[];
  /** Pass 5: opaque lane-grouping id (e.g. "gunslinger") for the QB/MIKE/Owner branch trees
   * Pass 6/7 author. Null/absent for every node in all 5 live catalogs today -- the frontend
   * renders a tier with no branched nodes exactly as it does now, a single flat row. */
  branch?: string | null;
};

export type CharacteristicSelectionError =
  | "count_exceeded"
  | "overlapping_attribute"
  | "unknown_characteristic"
  | "duplicate_characteristic"
  | "wrong_position_group"
  | "progression_tree_only";

export type CharacteristicPurchaseError =
  | "unknown_characteristic"
  | "wrong_position_group"
  | "already_owned"
  | "tier_locked"
  | "prerequisite_locked"
  | "origins_only"
  | "insufficient_xp";

/** Origins is free Tier 1 only. Tier 2+ is purchased later from the Progression Tree. */
export function isProgressionTreePerk(definition: Pick<CharacteristicDefinition, "tier">): boolean {
  return definition.tier >= 2;
}

export function characteristicKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function emptyModifiers(): CharacteristicModifiers {
  return {
    creationDiscounts: {},
    xpDiscounts: {},
    xpEarnBonus: 0,
    promotionCheckBonus: 0,
    teamXpFromSeason1: false,
    negotiatorMultiplier: 1,
    knownCommodityFloor: false,
    startDevStar: false,
    competitiveDriveBonusPct: 0,
    devTraitPurchaseUnlocked: false,
    teammateDevPurchaseUnlocked: false,
    tradeAccess: false,
    personnelCouncilTier: 0,
    releaseAuthorityUnlocked: false,
    franchiseInvestmentsUnlocked: false,
    investmentRoiBonus: 0,
    teammatePromotionDiscountRate: 0,
  };
}

const ATTR_TOKEN = /\b([A-Z]{3})\b/g;

function parsePercentDiscounts(effect: string): Record<string, number> {
  const discounts: Record<string, number> = {};
  const sentences = effect.split(/[.;]/);
  for (const sentence of sentences) {
    const percent = sentence.match(/(\d+(?:\.\d+)?)\s*%\s*less/i);
    if (!percent) continue;
    const rate = Number(percent[1]) / 100;
    const codes = [...sentence.matchAll(ATTR_TOKEN)].map((match) => match[1]);
    for (const code of codes) {
      discounts[code] = Math.max(discounts[code] ?? 0, rate);
    }
  }
  return discounts;
}

/** Pass 5: folds one structured EffectSpec into an already-initialized CharacteristicModifiers,
 * mutating in place. One case per variant -- every consumer file (xp.ts, contracts.ts,
 * xp-awards.service.ts, creation-points.ts, draft-stock.ts, ...) keeps reading the exact same
 * named CharacteristicModifiers fields it does today; this only changes how those fields get
 * populated for a node that declares explicit effects instead of relying on name-matching. */
export function applyEffect(modifiers: CharacteristicModifiers, effect: EffectSpec): void {
  switch (effect.type) {
    case "attribute_creation_discount":
      modifiers.creationDiscounts[effect.attribute] = Math.max(modifiers.creationDiscounts[effect.attribute] ?? 0, effect.rate);
      break;
    case "attribute_xp_discount":
      modifiers.xpDiscounts[effect.attribute] = Math.max(modifiers.xpDiscounts[effect.attribute] ?? 0, effect.rate);
      break;
    case "xp_earn_bonus":
      modifiers.xpEarnBonus += effect.value;
      break;
    case "promotion_check_bonus":
      modifiers.promotionCheckBonus += effect.value;
      break;
    case "team_xp_from_season_1":
      modifiers.teamXpFromSeason1 = true;
      break;
    case "negotiator_multiplier":
      modifiers.negotiatorMultiplier *= effect.value;
      break;
    case "known_commodity_floor":
      modifiers.knownCommodityFloor = true;
      break;
    case "start_dev_star":
      modifiers.startDevStar = true;
      break;
    case "competitive_drive_bonus_pct":
      modifiers.competitiveDriveBonusPct += effect.value;
      break;
    case "dev_trait_purchase_unlocked":
      modifiers.devTraitPurchaseUnlocked = true;
      break;
    case "teammate_dev_purchase_unlocked":
      modifiers.teammateDevPurchaseUnlocked = true;
      break;
    case "trade_access":
      modifiers.tradeAccess = true;
      break;
    case "personnel_council_tier":
      modifiers.personnelCouncilTier = Math.max(modifiers.personnelCouncilTier, effect.value);
      break;
    case "release_authority_unlocked":
      modifiers.releaseAuthorityUnlocked = true;
      break;
    case "franchise_investments_unlocked":
      modifiers.franchiseInvestmentsUnlocked = true;
      break;
    case "investment_roi_bonus":
      modifiers.investmentRoiBonus += effect.value;
      break;
    case "teammate_promotion_discount":
      modifiers.teammatePromotionDiscountRate = Math.max(modifiers.teammatePromotionDiscountRate, effect.rate);
      break;
    default:
      break;
  }
}

export function modifiersFromDefinition(input: {
  name: string;
  effect: string;
  effects?: EffectSpec[];
}): CharacteristicModifiers {
  const modifiers = emptyModifiers();
  // Pass 5: explicit effects skip the legacy name-matched switch entirely -- see EffectSpec's
  // doc comment. Every node in all 5 live catalogs today has no `effects` array, so this is a
  // pure no-op branch until Pass 6/7 authors new lane content that declares one.
  if (input.effects?.length) {
    for (const effect of input.effects) applyEffect(modifiers, effect);
    return modifiers;
  }
  const discounts = parsePercentDiscounts(input.effect);
  modifiers.creationDiscounts = { ...discounts };
  modifiers.xpDiscounts = { ...discounts };
  switch (characteristicKey(input.name)) {
    case "faster_developer":
      modifiers.xpEarnBonus = 0.15;
      modifiers.promotionCheckBonus = 0.5;
      break;
    case "team_player":
      modifiers.teamXpFromSeason1 = true;
      break;
    case "great_negotiator":
      modifiers.negotiatorMultiplier = 1.2;
      break;
    case "known_commodity":
      modifiers.knownCommodityFloor = true;
      break;
    case "generational_ceiling":
      modifiers.startDevStar = true;
      break;
    case "competitive_drive":
      modifiers.competitiveDriveBonusPct = 0.05;
      break;
    case "self_made":
      modifiers.devTraitPurchaseUnlocked = true;
      break;
    case "development_staff":
      modifiers.teammateDevPurchaseUnlocked = true;
      break;
    case "spotlight":
      modifiers.xpEarnBonus = 0.1;
      break;
    case "personnel_chief":
      modifiers.tradeAccess = true;
      break;
    default:
      break;
  }
  return modifiers;
}

/** Post-draft/Progression-Tree attribute-upgrade discount -- unlike creation discounts, these
 * stack additively with no percentage cap (any per-upgrade floor is enforced separately by
 * discountedXpCost's Math.max(1, ...) in xp.ts, not here). */
export function xpDiscountForAttribute(modifiers: CharacteristicModifiers, attributeCode: string): number {
  return stackPostDraftDiscounts([modifiers.xpDiscounts[attributeCode] ?? 0, modifiers.xpDiscounts[ALL_ATTRIBUTES_DISCOUNT_CODE] ?? 0]);
}

export function creationDiscountForAttribute(modifiers: CharacteristicModifiers, attributeCode: string): number {
  return stackDiscounts([modifiers.creationDiscounts[attributeCode] ?? 0, modifiers.creationDiscounts[ALL_ATTRIBUTES_DISCOUNT_CODE] ?? 0]);
}

/** Attribute codes (plus the "ALL" sentinel for broad-discount perks like Complete Package)
 * this characteristic discounts -- used to block equipping two characteristics that touch the
 * same rating, rather than letting them stack. */
export function attributeCodesFor(definition: Pick<CharacteristicDefinition, "modifiers">): string[] {
  return Object.keys(definition.modifiers.creationDiscounts);
}

/** Creation-time discount stacking only (Origins characteristics against baseline Creation
 * Points cost) -- capped, with diminishing returns on overlapping perks. Post-draft/Progression-
 * Tree attribute-upgrade discounts use stackPostDraftDiscounts below instead, which is uncapped. */
export function stackDiscounts(rates: number[]): number {
  const sorted = [...rates].filter((rate) => rate > 0).sort((a, b) => b - a);
  if (!sorted.length) return 0;
  const weights = [1, SECOND_OVERLAP_EFFECTIVENESS, THIRD_OVERLAP_EFFECTIVENESS];
  let total = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const weight = weights[index] ?? 0;
    total += sorted[index] * weight;
  }
  return Math.min(MAX_ATTRIBUTE_DISCOUNT, total);
}

/** Post-draft/Progression-Tree attribute-upgrade discount stacking -- plain additive sum, no
 * percentage cap and no diminishing weight on overlapping perks (unlike the creation-time
 * stackDiscounts above). A per-upgrade cost floor is still enforced downstream by
 * discountedXpCost's Math.max(1, ...) in xp.ts, so this can legitimately exceed 100%. */
export function stackPostDraftDiscounts(rates: number[]): number {
  return rates.reduce((total, rate) => total + Math.max(0, rate), 0);
}

export function combinedModifiers(selected: CharacteristicDefinition[]): CharacteristicModifiers {
  const combined = emptyModifiers();
  const creationRates: Record<string, number[]> = {};
  const xpRates: Record<string, number[]> = {};
  for (const item of selected) {
    combined.xpEarnBonus += item.modifiers.xpEarnBonus;
    combined.promotionCheckBonus += item.modifiers.promotionCheckBonus;
    combined.teamXpFromSeason1 = combined.teamXpFromSeason1 || item.modifiers.teamXpFromSeason1;
    combined.negotiatorMultiplier *= item.modifiers.negotiatorMultiplier;
    combined.knownCommodityFloor = combined.knownCommodityFloor || item.modifiers.knownCommodityFloor;
    combined.startDevStar = combined.startDevStar || item.modifiers.startDevStar;
    combined.competitiveDriveBonusPct += item.modifiers.competitiveDriveBonusPct;
    combined.devTraitPurchaseUnlocked = combined.devTraitPurchaseUnlocked || item.modifiers.devTraitPurchaseUnlocked;
    combined.teammateDevPurchaseUnlocked = combined.teammateDevPurchaseUnlocked || item.modifiers.teammateDevPurchaseUnlocked;
    combined.tradeAccess = combined.tradeAccess || item.modifiers.tradeAccess;
    combined.personnelCouncilTier = Math.max(combined.personnelCouncilTier, item.modifiers.personnelCouncilTier);
    combined.releaseAuthorityUnlocked = combined.releaseAuthorityUnlocked || item.modifiers.releaseAuthorityUnlocked;
    combined.franchiseInvestmentsUnlocked = combined.franchiseInvestmentsUnlocked || item.modifiers.franchiseInvestmentsUnlocked;
    combined.investmentRoiBonus += item.modifiers.investmentRoiBonus;
    combined.teammatePromotionDiscountRate = Math.max(combined.teammatePromotionDiscountRate, item.modifiers.teammatePromotionDiscountRate);
    for (const [code, rate] of Object.entries(item.modifiers.creationDiscounts)) {
      (creationRates[code] ??= []).push(rate);
    }
    for (const [code, rate] of Object.entries(item.modifiers.xpDiscounts)) {
      (xpRates[code] ??= []).push(rate);
    }
  }
  for (const [code, rates] of Object.entries(creationRates)) {
    combined.creationDiscounts[code] = stackDiscounts(rates);
  }
  for (const [code, rates] of Object.entries(xpRates)) {
    combined.xpDiscounts[code] = stackPostDraftDiscounts(rates);
  }
  return combined;
}

export function validateCharacteristicSelection(input: {
  positionGroup: ImmortalityPositionGroup;
  catalog: CharacteristicDefinition[];
  keys: string[];
}): { ok: true; selected: CharacteristicDefinition[]; slotCost: number } | { ok: false; error: CharacteristicSelectionError } {
  const selected: CharacteristicDefinition[] = [];
  const seen = new Set<string>();
  const seenAttributeCodes = new Set<string>();
  let slotCost = 0;
  for (const key of input.keys) {
    if (seen.has(key)) return { ok: false, error: "duplicate_characteristic" };
    seen.add(key);
    const definition = input.catalog.find((item) => item.key === key);
    if (!definition) return { ok: false, error: "unknown_characteristic" };
    if (definition.positionGroup !== input.positionGroup) return { ok: false, error: "wrong_position_group" };
    if (isProgressionTreePerk(definition)) return { ok: false, error: "progression_tree_only" };
    for (const code of attributeCodesFor(definition)) {
      if (seenAttributeCodes.has(code)) return { ok: false, error: "overlapping_attribute" };
      seenAttributeCodes.add(code);
    }
    selected.push(definition);
    slotCost += definition.slotCost;
  }
  if (selected.length > MAX_EQUIPPED_CHARACTERISTICS) return { ok: false, error: "count_exceeded" };
  return { ok: true, selected, slotCost };
}

export function purchaseCharacteristic(input: {
  positionGroup: ImmortalityPositionGroup;
  catalog: CharacteristicDefinition[];
  ownedKeys: string[];
  key: string;
  availableXp: number;
}):
  | { ok: true; xpCost: number; slotCost: number }
  | { ok: false; error: CharacteristicPurchaseError; missingKeys?: string[] } {
  const definition = input.catalog.find((item) => item.key === input.key);
  if (!definition) return { ok: false, error: "unknown_characteristic" };
  if (definition.positionGroup !== input.positionGroup) return { ok: false, error: "wrong_position_group" };
  if (input.ownedKeys.includes(input.key)) return { ok: false, error: "already_owned" };
  if (!isProgressionTreePerk(definition)) return { ok: false, error: "origins_only" };

  const owned = input.catalog.filter((item) => input.ownedKeys.includes(item.key));
  // Pass 5: a node with an explicit `requires` array (even an empty one -- see that field's doc
  // comment, added in Pass 7 for Owner's lane-opener nodes) is gated by those specific keys (AND)
  // instead of the original flat tier-count rule below. Every node in the 5 original catalogs
  // has `requires` entirely absent (undefined), so this branch was a no-op there until Pass 6
  // authored real lane chains; `undefined !== []`, so this check is unaffected by the empty-array
  // case newly introduced for Owner.
  if (definition.requires !== undefined) {
    const ownedSet = new Set(input.ownedKeys);
    const missingKeys = definition.requires.filter((key) => !ownedSet.has(key));
    if (missingKeys.length) return { ok: false, error: "prerequisite_locked", missingKeys };
  } else if (definition.tier === 2 && owned.filter((item) => item.tier === 1).length < 2) {
    return { ok: false, error: "tier_locked" };
  } else if (definition.tier === 3 && !owned.some((item) => item.tier === 2)) {
    return { ok: false, error: "tier_locked" };
  } else if (definition.tier === 4 && !owned.some((item) => item.tier === 3)) {
    return { ok: false, error: "tier_locked" };
  }

  if (input.availableXp < definition.xpCost) return { ok: false, error: "insufficient_xp" };

  return { ok: true, xpCost: definition.xpCost, slotCost: definition.slotCost };
}
