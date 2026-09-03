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
  weeklySweepBonusXp: number;
  devTraitPurchaseUnlocked: boolean;
  teammateDevPurchaseUnlocked: boolean;
  tradeAccess: boolean;
};

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
    weeklySweepBonusXp: 0,
    devTraitPurchaseUnlocked: false,
    teammateDevPurchaseUnlocked: false,
    tradeAccess: false,
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

export function modifiersFromDefinition(input: {
  name: string;
  effect: string;
}): CharacteristicModifiers {
  const modifiers = emptyModifiers();
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
      modifiers.weeklySweepBonusXp = 2;
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

export function xpDiscountForAttribute(modifiers: CharacteristicModifiers, attributeCode: string): number {
  return stackDiscounts([modifiers.xpDiscounts[attributeCode] ?? 0, modifiers.xpDiscounts[ALL_ATTRIBUTES_DISCOUNT_CODE] ?? 0]);
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
    combined.weeklySweepBonusXp += item.modifiers.weeklySweepBonusXp;
    combined.devTraitPurchaseUnlocked = combined.devTraitPurchaseUnlocked || item.modifiers.devTraitPurchaseUnlocked;
    combined.teammateDevPurchaseUnlocked = combined.teammateDevPurchaseUnlocked || item.modifiers.teammateDevPurchaseUnlocked;
    combined.tradeAccess = combined.tradeAccess || item.modifiers.tradeAccess;
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
    combined.xpDiscounts[code] = stackDiscounts(rates);
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
}): { ok: true; xpCost: number; slotCost: number } | { ok: false; error: CharacteristicPurchaseError } {
  const definition = input.catalog.find((item) => item.key === input.key);
  if (!definition) return { ok: false, error: "unknown_characteristic" };
  if (definition.positionGroup !== input.positionGroup) return { ok: false, error: "wrong_position_group" };
  if (input.ownedKeys.includes(input.key)) return { ok: false, error: "already_owned" };
  if (!isProgressionTreePerk(definition)) return { ok: false, error: "origins_only" };

  const owned = input.catalog.filter((item) => input.ownedKeys.includes(item.key));
  if (definition.tier === 2 && owned.filter((item) => item.tier === 1).length < 2) {
    return { ok: false, error: "tier_locked" };
  }
  if (definition.tier === 3 && !owned.some((item) => item.tier === 2)) {
    return { ok: false, error: "tier_locked" };
  }
  if (definition.tier === 4 && !owned.some((item) => item.tier === 3)) {
    return { ok: false, error: "tier_locked" };
  }

  if (input.availableXp < definition.xpCost) return { ok: false, error: "insufficient_xp" };

  return { ok: true, xpCost: definition.xpCost, slotCost: definition.slotCost };
}
