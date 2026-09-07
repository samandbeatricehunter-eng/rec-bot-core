import abilitiesJson from "./config/abilities_m27.json" with { type: "json" };
import archetypeAbilityLocksJson from "./config/archetype_ability_locks.json" with { type: "json" };
import type { ImmortalityDevTrait, ImmortalityPosition } from "./types.js";
import { FORMULA_VERSIONS } from "./types.js";

export const ABILITY_FORMULA_VERSION = FORMULA_VERSIONS.abilities;
export const MAX_EQUIPPED_ABILITIES = 4;

export type AbilityKind = "superstar" | "xfactor";
export type AbilityGateSource =
  | "madden_tools"
  | "madden_tools_inherited"
  | "madden_tools_default"
  | "madden_school"
  | "empirical_roster";

export type AbilityGate = {
  position: ImmortalityPosition;
  archetypes: string[];
  ovrMin: number;
  maddenArchetype: string | null;
  source: AbilityGateSource;
};

export type Madden27Ability = {
  id: string;
  name: string;
  description: string;
  kind: AbilityKind;
  upgradesWith: { primary: string; secondary: string | null };
  gates: AbilityGate[];
  observed: {
    holders: number;
    ovrMin: number | null;
    ovrMedian: number | null;
    primaryMin: number | null;
    primaryMedian: number | null;
    secondaryMin: number | null;
  };
  launchPositions: Array<{ position: string; count: number }>;
  rtiPositions: ImmortalityPosition[];
  rtiEligible: boolean;
  confidence: "madden_tools" | "madden_school" | "empirical_roster";
};

const catalog = abilitiesJson as unknown as { _meta: unknown; abilities: Madden27Ability[] };

export function madden27AbilityCatalog(): Madden27Ability[] {
  return catalog.abilities;
}

export function rtiAbilitiesForPosition(position: ImmortalityPosition): Madden27Ability[] {
  return catalog.abilities.filter((ability) => ability.rtiPositions.includes(position));
}

export function abilityById(id: string): Madden27Ability | null {
  return catalog.abilities.find((ability) => ability.id === id) ?? null;
}

export function playerArchetypes(primary: string | null | undefined, secondary?: string | null): string[] {
  return [primary, secondary].map((value) => String(value ?? "").trim()).filter(Boolean);
}

export function gatesForPosition(ability: Pick<Madden27Ability, "gates">, position: ImmortalityPosition): AbilityGate[] {
  return ability.gates.filter((gate) => gate.position === position);
}

export function matchingAbilityGate(input: {
  ability: Pick<Madden27Ability, "gates">;
  position: ImmortalityPosition;
  archetypes: string[];
  estimatedOvr: number;
}): AbilityGate | null {
  const ovr = Number(input.estimatedOvr);
  if (!Number.isFinite(ovr)) return null;
  const matches = gatesForPosition(input.ability, input.position).filter((gate) => {
    if (ovr < gate.ovrMin) return false;
    return gate.archetypes.includes("any") || gate.archetypes.some((name) => input.archetypes.includes(name));
  });
  if (!matches.length) return null;
  return matches.reduce((best, gate) => (gate.ovrMin > best.ovrMin ? gate : best));
}

function assignmentBlockReason(input: {
  ability: Madden27Ability;
  position: ImmortalityPosition;
  archetypes: string[];
  estimatedOvr: number;
}): string {
  const posGates = gatesForPosition(input.ability, input.position);
  if (!posGates.length) return "That ability is not available at this position.";
  const archetypeGates = posGates.filter((gate) => (
    gate.archetypes.includes("any") || gate.archetypes.some((name) => input.archetypes.includes(name))
  ));
  if (!archetypeGates.length) {
    const needed = [...new Set(posGates.flatMap((gate) => gate.archetypes.includes("any") ? ["any playstyle"] : gate.archetypes))];
    const have = input.archetypes[0] ? ` Your playstyle is ${input.archetypes.join(" / ")}.` : "";
    return `Needs ${needed.join(" or ")} at ${input.position}.${have}`;
  }
  const needOvr = Math.min(...archetypeGates.map((gate) => gate.ovrMin));
  const label = archetypeGates[0]?.maddenArchetype && archetypeGates[0].maddenArchetype !== "Any"
    ? ` (${archetypeGates[0].maddenArchetype})`
    : "";
  return `Needs ${needOvr}+ OVR${label}. Currently ${Math.floor(input.estimatedOvr) || 0}.`;
}

export function canSelectAbility(input: {
  ability: Madden27Ability;
  position: ImmortalityPosition;
  archetypes: string[];
  estimatedOvr: number;
  equippedCount: number;
  alreadyEquipped: boolean;
}): { ok: true; gate: AbilityGate } | { ok: false; error: string; gate: AbilityGate | null } {
  if (!input.ability.rtiPositions.includes(input.position)) {
    return { ok: false, error: "That ability is not available at this position.", gate: null };
  }
  if (input.alreadyEquipped) {
    return { ok: false, error: "That ability is already assigned.", gate: matchingAbilityGate(input) };
  }
  if (input.equippedCount >= MAX_EQUIPPED_ABILITIES) {
    return { ok: false, error: "You can assign up to 4 abilities. Remove one first.", gate: matchingAbilityGate(input) };
  }
  const gate = matchingAbilityGate(input);
  if (!gate) {
    return { ok: false, error: assignmentBlockReason(input), gate: null };
  }
  return { ok: true, gate };
}

// --- Archetype-locked mandatory abilities (Superstar/X-Factor identity) -------------------

export type MandatoryAbilitySet = {
  superstar: [string, string];
  xfactor: string;
};

type ArchetypeAbilityLocks = Record<string, Record<string, MandatoryAbilitySet>>;

const archetypeAbilityLocks = archetypeAbilityLocksJson as unknown as ArchetypeAbilityLocks & { _meta: unknown };

export function mandatoryAbilitiesForArchetype(position: ImmortalityPosition, archetype: string): MandatoryAbilitySet | null {
  return archetypeAbilityLocks[position]?.[archetype] ?? null;
}

/** True if `abilityName` is designated as one of `archetype`'s mandatory picks at `position` --
 * this bypasses the ability's own real-Madden archetype gate for cases where REC assigns an
 * ability to an archetype it wasn't originally gated for (e.g. Reinforcement -> Run Stopper). */
export function isMandatoryAbilityAssignment(input: { position: ImmortalityPosition; archetype: string; abilityName: string }): boolean {
  const locks = mandatoryAbilitiesForArchetype(input.position, input.archetype);
  if (!locks) return false;
  return locks.superstar.includes(input.abilityName) || locks.xfactor === input.abilityName;
}

// --- Ability slot progression (real Madden slot ceiling, gated by dev trait + OVR) --------
//
// Real Madden: Superstar dev players can hold up to 3 Superstar abilities (a 3rd unlocks at an
// OVR gate); X-Factor dev players can hold up to 4 Superstar abilities plus their X-Factor.
// REC's progression: the first two Superstar slots are always the archetype-mandatory pair,
// unlocking in sequence rather than both at once; the 3rd and 4th slots are free-pick once
// unlocked (pre-Ability-Mastery, still constrained by each ability's own gate). These OVR
// thresholds reuse the same table already used for Ability Mastery/X-Factor Mastery -- flagged
// for confirmation since real Madden's exact slot-unlock OVR isn't independently sourced here.
export const SUPERSTAR_SLOT_1_OVR = 80;
export const SUPERSTAR_SLOT_2_OVR = 84;
export const SUPERSTAR_SLOT_3_OVR = 87;
export const XFACTOR_SLOT_OVR = 87;

export type AbilitySlotState = {
  /** How many Superstar slots (0-4) are currently open, regardless of whether they're filled. */
  superstarSlots: number;
  /** How many of the open Superstar slots are still archetype-locked (mandatory pair), 0-2. */
  lockedSuperstarSlots: number;
  hasXFactorSlot: boolean;
  xFactorLocked: boolean;
};

export function abilitySlotState(input: { devTrait: ImmortalityDevTrait; estimatedOvr: number }): AbilitySlotState {
  const ovr = Number(input.estimatedOvr) || 0;
  const isSuperstarOrAbove = input.devTrait === "superstar" || input.devTrait === "xfactor";
  const isXFactor = input.devTrait === "xfactor";
  if (!isSuperstarOrAbove) {
    return { superstarSlots: 0, lockedSuperstarSlots: 0, hasXFactorSlot: false, xFactorLocked: false };
  }
  let superstarSlots = 0;
  if (ovr >= SUPERSTAR_SLOT_1_OVR) superstarSlots = 1;
  if (ovr >= SUPERSTAR_SLOT_2_OVR) superstarSlots = 2;
  if (ovr >= SUPERSTAR_SLOT_3_OVR) superstarSlots = 3;
  if (isXFactor && ovr >= XFACTOR_SLOT_OVR) superstarSlots = 4;
  const lockedSuperstarSlots = Math.min(superstarSlots, 2);
  const hasXFactorSlot = isXFactor && ovr >= XFACTOR_SLOT_OVR;
  return { superstarSlots, lockedSuperstarSlots, hasXFactorSlot, xFactorLocked: hasXFactorSlot };
}

// --- Pass 8 (Ability Lab): real per-slot state straight from the EA Companion export ------
//
// rec_players.abilities stores EA's raw signatureSlotList verbatim for a real roster-imported
// player: one entry per ability slot, each carrying its OWN real ovrThreshold (varies per
// player/slot -- not a fixed constant) and whether that slot is currently empty. This is a real
// ground-truth alternative to abilitySlotState's guessed OVR constants above, available the
// moment a prospect's placeholder is adopted onto a real EA roster row with a populated export.
// Falls back to null (never guesses) when the column doesn't look like this shape -- e.g. still
// null before adoption, or a legend/custom-player row using the older simple {name,description}
// shape -- so callers can fall back to the ledger/OVR-constant model instead.
export type RealAbilitySlot = {
  ovrThreshold: number;
  unlocked: boolean;
  empty: boolean;
  rank: string | null;
  title: string | null;
  description: string | null;
};

export type RealAbilitySlotState = {
  totalSlots: number;
  unlockedSlots: number;
  equippedSlots: number;
  slots: RealAbilitySlot[];
};

function isRichAbilitySlotShape(value: unknown): value is { ovrThreshold: unknown; isEmpty: unknown; signatureAbility?: Record<string, unknown> } {
  return Boolean(value) && typeof value === "object" && "ovrThreshold" in (value as object) && "isEmpty" in (value as object);
}

/** Returns null (not a real-shape column, or no rows) so callers fall back to the ledger/OVR-
 * constant model -- this never guesses a slot count from a shape it doesn't recognize. */
export function realAbilitySlotState(rawAbilities: unknown, overallRating: number | null): RealAbilitySlotState | null {
  if (!Array.isArray(rawAbilities) || !rawAbilities.length) return null;
  if (!rawAbilities.every(isRichAbilitySlotShape)) return null;
  const ovr = Number(overallRating ?? 0) || 0;
  const slots: RealAbilitySlot[] = rawAbilities.map((row) => {
    const threshold = Number(row.ovrThreshold ?? 0) || 0;
    const sig = (row.signatureAbility ?? {}) as Record<string, unknown>;
    return {
      ovrThreshold: threshold,
      unlocked: ovr >= threshold,
      empty: Boolean(row.isEmpty),
      rank: typeof sig.rank === "string" ? sig.rank : null,
      title: typeof sig.signatureTitle === "string" ? sig.signatureTitle : null,
      description: typeof sig.signatureDescription === "string" ? sig.signatureDescription : null,
    };
  });
  const unlockedSlots = slots.filter((slot) => slot.unlocked).length;
  const equippedSlots = slots.filter((slot) => slot.unlocked && !slot.empty).length;
  return { totalSlots: slots.length, unlockedSlots, equippedSlots, slots };
}
