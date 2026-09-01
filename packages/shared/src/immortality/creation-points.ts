import { FORMULA_VERSIONS, type AttributeMap, type ImmortalityDevTrait, type ImmortalityPosition } from "./types.js";
import type { CharacteristicModifiers } from "./characteristics.js";

export const DEFAULT_CREATION_POINT_BUDGET = 60;
export const CREATION_POINT_CALIBRATION_BUDGETS = [45, 50, 55, 60, 65] as const;

/** Historical real-NFL max height per position, in inches. A prospect can go taller, but each
 * inch over costs HEIGHT_OVERAGE_CP_COST_PER_INCH out of the Creation Point budget -- these are
 * a first-pass estimate, not sourced from real positional height data yet; adjust freely. */
export const IMMORTALITY_POSITION_MAX_HEIGHT_INCHES: Record<ImmortalityPosition, number> = {
  QB: 76, HB: 74, WR: 77, TE: 79,
  CB: 75, FS: 75, SS: 76, MIKE: 76,
};
export const HEIGHT_OVERAGE_CP_COST_PER_INCH = 20;

export function heightOverageCreationPointCost(position: ImmortalityPosition, heightInches: number): number {
  const max = IMMORTALITY_POSITION_MAX_HEIGHT_INCHES[position];
  return Math.max(0, heightInches - max) * HEIGHT_OVERAGE_CP_COST_PER_INCH;
}

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
  /** Rating increases on top of the generated baseline, not absolute ratings. */
  spent: AttributeMap;
  budget?: number;
  discounts?: Record<string, number>;
}): { ok: true; remaining: number; attributes: AttributeMap; spentPoints: number } | { ok: false; error: string } {
  const budget = input.budget ?? DEFAULT_CREATION_POINT_BUDGET;
  const attributes: AttributeMap = { ...input.baseline };
  let spentPoints = 0;
  for (const [code, rawDelta] of Object.entries(input.spent)) {
    const baseline = input.baseline[code] ?? 0;
    const delta = Math.round(rawDelta);
    if (delta < 0) return { ok: false, error: `${code} cannot be lowered below the generated baseline.` };
    const target = baseline + delta;
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
