import { FORMULA_VERSIONS, type AttributeMap, type ImmortalityDevTrait } from "./types.js";
import type { CharacteristicModifiers } from "./characteristics.js";

export const DEFAULT_CREATION_POINT_BUDGET = 60;
export const CREATION_POINT_CALIBRATION_BUDGETS = [45, 50, 55, 60, 65] as const;

export function creationPointCostForValue(nextValue: number): number {
  if (nextValue < 70) return 1;
  if (nextValue < 80) return 2;
  if (nextValue < 85) return 3;
  if (nextValue < 90) return 4;
  return 6;
}

export function discountedCreationCost(nextValue: number, discount: number): number {
  const raw = creationPointCostForValue(nextValue);
  return Math.max(1, Math.round(raw * (1 - Math.min(0.3, Math.max(0, discount)))));
}

export function spendCreationPoints(input: {
  baseline: AttributeMap;
  spent: AttributeMap;
  budget?: number;
  discounts?: Record<string, number>;
}): { ok: true; remaining: number; attributes: AttributeMap; spentPoints: number } | { ok: false; error: string } {
  const budget = input.budget ?? DEFAULT_CREATION_POINT_BUDGET;
  const attributes: AttributeMap = { ...input.baseline };
  let spentPoints = 0;
  for (const [code, rawTarget] of Object.entries(input.spent)) {
    const baseline = input.baseline[code] ?? 0;
    const target = Math.round(rawTarget);
    if (target < baseline) return { ok: false, error: `${code} cannot be lowered below the generated baseline.` };
    if (target > 99) return { ok: false, error: `${code} cannot exceed 99.` };
    const discount = input.discounts?.[code] ?? 0;
    for (let value = baseline + 1; value <= target; value += 1) {
      spentPoints += discountedCreationCost(value, discount);
    }
    attributes[code] = target;
  }
  if (spentPoints > budget) return { ok: false, error: "Creation Point budget exceeded." };
  return { ok: true, remaining: budget - spentPoints, attributes, spentPoints };
}

export function startingDevTrait(modifiers: CharacteristicModifiers): ImmortalityDevTrait {
  return modifiers.startDevStar ? "star" : "normal";
}

export const CREATION_POINT_FORMULA_VERSION = FORMULA_VERSIONS.creationPoints;
