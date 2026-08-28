import abilitiesJson from "./config/abilities_m27.json" with { type: "json" };
import type { ImmortalityPosition } from "./types.js";
import { FORMULA_VERSIONS } from "./types.js";

export const ABILITY_FORMULA_VERSION = FORMULA_VERSIONS.abilities;
export const MAX_EQUIPPED_ABILITIES = 4;

export type AbilityKind = "superstar" | "xfactor";
export type AbilityTier = "none" | "bronze" | "silver" | "gold";

export type AbilityFloors = { bronze: number; silver: number; gold: number };

export type Madden27Ability = {
  id: string;
  name: string;
  description: string;
  kind: AbilityKind;
  primary: string;
  secondary: string | null;
  floors: AbilityFloors;
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
  confidence: "empirical_roster" | "modeled_plus_thin_roster";
};

export const ABILITY_GRANT_SLOTS: Record<string, number> = {
  weekly_gold: 1,
  season_tier1: 1,
  season_tier3: 1,
  career_minor: 1,
  career_major: 1,
  career_historic: 1,
  award: 1,
  championship: 1,
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

export function abilityGrantSlotsForEvent(eventType: string): number {
  return ABILITY_GRANT_SLOTS[eventType] ?? 0;
}

export function cappedAbilitySlots(earnedSlots: number): number {
  return Math.max(0, Math.min(MAX_EQUIPPED_ABILITIES, Math.floor(earnedSlots)));
}

export function resolveAbilityTier(
  ability: Pick<Madden27Ability, "floors" | "primary" | "secondary">,
  attributes: Record<string, number | null | undefined>,
): AbilityTier {
  const primary = Number(attributes[ability.primary] ?? 0);
  const secondary = ability.secondary ? Number(attributes[ability.secondary] ?? 0) : primary;
  const rating = Math.min(primary, secondary);
  if (!Number.isFinite(rating) || rating < ability.floors.bronze) return "none";
  if (rating >= ability.floors.gold) return "gold";
  if (rating >= ability.floors.silver) return "silver";
  return "bronze";
}

export function abilityMeetsInGameFloor(
  ability: Pick<Madden27Ability, "floors" | "primary" | "secondary" | "kind">,
  attributes: Record<string, number | null | undefined>,
): boolean {
  const tier = resolveAbilityTier(ability, attributes);
  if (ability.kind === "xfactor") return tier === "gold";
  return tier !== "none";
}

export function canSelectAbility(input: {
  ability: Madden27Ability;
  position: ImmortalityPosition;
  attributes: Record<string, number | null | undefined>;
  earnedSlots: number;
  equippedCount: number;
  alreadyEquipped: boolean;
}): { ok: true; tier: AbilityTier } | { ok: false; error: string; tier: AbilityTier } {
  const tier = resolveAbilityTier(input.ability, input.attributes);
  if (!input.ability.rtiPositions.includes(input.position)) {
    return { ok: false, error: "That ability is not available at this position.", tier };
  }
  if (input.alreadyEquipped) {
    return { ok: false, error: "That ability is already equipped.", tier };
  }
  const slots = cappedAbilitySlots(input.earnedSlots);
  if (input.equippedCount >= slots) {
    return { ok: false, error: `You have ${slots} ability slot${slots === 1 ? "" : "s"} from performance. Earn more Gold weeks, season milestones, or awards.`, tier };
  }
  if (input.ability.kind === "xfactor" && slots < 3) {
    return { ok: false, error: "X-Factor abilities unlock after three performance grants.", tier };
  }
  if (!abilityMeetsInGameFloor(input.ability, input.attributes)) {
    const need = input.ability.kind === "xfactor" ? input.ability.floors.gold : input.ability.floors.bronze;
    const extra = input.ability.secondary ? ` and ${input.ability.floors.bronze} ${input.ability.secondary}` : "";
    return {
      ok: false,
      error: `Madden needs ${need}+ ${input.ability.primary}${extra} before this ability applies in-game. Raise the rating with Player XP first.`,
      tier,
    };
  }
  return { ok: true, tier };
}
