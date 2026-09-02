import { FORMULA_VERSIONS } from "./types.js";

export type AbilityOrigin = "natural" | "learned";

/** OVR gates match the table you gave directly. XP costs are rescaled off the real economy in
 * xp.ts (a great season nets ~20-25 XP; career milestones are ~33/66/116 XP one-time) --
 * your original 15,000/25,000 numbers were calibrated to a different, much larger scale. */
export const ABILITY_MASTERY_OVR = 90;
export const XFACTOR_MASTERY_OVR = 93;
export const ABILITY_MASTERY_XP_COST = 40;
export const XFACTOR_MASTERY_XP_COST = 80;

/** Filling an open slot for the first time is always free -- only changing an already-set
 * ability costs XP, whether that's one of the free-pick slots pre-mastery or a newly-freed
 * archetype slot post-mastery. */
export const ABILITY_CHANGE_XP_COST = 8;

export function costToSetAbility(input: { slotPreviouslyFilled: boolean }): number {
  return input.slotPreviouslyFilled ? ABILITY_CHANGE_XP_COST : 0;
}

export function canUnlockAbilityMastery(input: {
  estimatedOvr: number;
  availableXp: number;
  alreadyUnlocked: boolean;
}): { ok: true; cost: number } | { ok: false; error: string } {
  if (input.alreadyUnlocked) return { ok: false, error: "Ability Mastery is already unlocked." };
  if (input.estimatedOvr < ABILITY_MASTERY_OVR) return { ok: false, error: `Need ${ABILITY_MASTERY_OVR}+ OVR.` };
  if (input.availableXp < ABILITY_MASTERY_XP_COST) return { ok: false, error: `Need ${ABILITY_MASTERY_XP_COST} Player XP.` };
  return { ok: true, cost: ABILITY_MASTERY_XP_COST };
}

export function canUnlockXFactorMastery(input: {
  estimatedOvr: number;
  availableXp: number;
  abilityMasteryUnlocked: boolean;
  alreadyUnlocked: boolean;
}): { ok: true; cost: number } | { ok: false; error: string } {
  if (input.alreadyUnlocked) return { ok: false, error: "X-Factor Mastery is already unlocked." };
  if (!input.abilityMasteryUnlocked) return { ok: false, error: "Unlock Ability Mastery first." };
  if (input.estimatedOvr < XFACTOR_MASTERY_OVR) return { ok: false, error: `Need ${XFACTOR_MASTERY_OVR}+ OVR.` };
  if (input.availableXp < XFACTOR_MASTERY_XP_COST) return { ok: false, error: `Need ${XFACTOR_MASTERY_XP_COST} Player XP.` };
  return { ok: true, cost: XFACTOR_MASTERY_XP_COST };
}

export const ABILITY_MASTERY_FORMULA_VERSION = FORMULA_VERSIONS.abilityMastery;
