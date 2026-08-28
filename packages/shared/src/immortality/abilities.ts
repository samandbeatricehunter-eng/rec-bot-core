import abilitiesJson from "./config/abilities_m27.json" with { type: "json" };
import type { ImmortalityPosition } from "./types.js";
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
