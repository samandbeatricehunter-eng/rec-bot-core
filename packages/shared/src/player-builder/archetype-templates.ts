/**
 * Archetype-based custom-player wizard: instead of building every attribute up from a flat
 * 35 floor, a user picks a real-player template (frozen as the new floor — never lowerable)
 * and spends the tier's bonus CP building further from there. Guarantees an accurate base OVR
 * (it's copied from a real player) and makes the CP-to-OVR estimate a small, trustworthy delta
 * instead of REC's discredited "guess the whole build" cap (see build-validator.ts v1.7.0).
 *
 * Template attribute sets and bonus-CP budgets are generated from real Madden 27 rosters — see
 * apps/api/scripts/curate-archetype-templates.ts and calibrate-archetype-cp-budgets.ts for the
 * generation methodology, and archetype-templates.data.ts for the embedded output.
 */
import { normalizeRecOvrPosition, type RecOvrPosition } from "./ovr-model.js";
import type { RecPackageTier } from "./archetypes.js";
import {
  REC_ARCHETYPE_CP_BUDGET_DATA,
  REC_ARCHETYPE_TEMPLATE_DATA,
  type RecArchetypeTemplateRow,
} from "./archetype-templates.data.js";

// Base template OVR target per tier (Samuel, 2026-08) — deliberately modest so the tier's
// bonus CP is what actually builds the player up, not the template alone.
export const REC_ARCHETYPE_BASE_OVR_TARGET: Readonly<Record<RecPackageTier, number>> = {
  1: 66,
  2: 69,
  3: 75,
  4: 79,
  5: 82,
};

// The estimated OVR a tier's bonus CP is calibrated to reach from the base template (Tier 1 is
// template-only — no bonus CP, so no growth target).
export const REC_ARCHETYPE_GROWTH_OVR_TARGET: Readonly<Record<RecPackageTier, number | null>> = {
  1: null,
  2: 72,
  3: 78,
  4: 82,
  5: 86,
};

// Default development trait tier per package tier (Madden naming: normal/star/superstar/xfactor;
// CFB naming: normal/impact/star/elite — index-aligned in REC_DEV_TRAITS in catalog.ts).
export const REC_ARCHETYPE_DEFAULT_DEV_TRAIT_INDEX: Readonly<Record<RecPackageTier, number>> = {
  1: 0, // Normal
  2: 0, // Normal
  3: 1, // Star / Impact
  4: 1, // Star / Impact
  5: 2, // Superstar / Star (CFB's 3rd tier)
};

// Cost to go up one dev-trait tier from that tier's default — tuned (2026-08) to roughly match
// the median attribute-target CP cost across positions, so spending bonus CP on a dev bump is a
// real alternative to spending it on attributes, not trivial (old flat 400/600/600/800 ladder)
// or unaffordable.
export const REC_ARCHETYPE_DEV_UPGRADE_CP: Readonly<Record<RecPackageTier, number>> = {
  1: 0,
  2: 100,
  3: 200,
  4: 400,
  5: 700,
};

export type { RecArchetypeTemplateRow };

/** Every curated real-player template for a position/tier — up to 3, one per archetype. */
export function getRecArchetypeTemplates(positionInput: string, tier: RecPackageTier): readonly RecArchetypeTemplateRow[] {
  const position = normalizeRecOvrPosition(positionInput);
  const rows = REC_ARCHETYPE_TEMPLATE_DATA[position] ?? [];
  return rows.filter((row) => row.tier === tier);
}

/** The bonus CP budget for a position/tier — max(attribute-target cost, dev-upgrade cost), so
 * every position can afford either path regardless of how cheap/expensive its attribute climb
 * is. Tier 1 is always 0 (template-only). */
export function getRecArchetypeBonusCp(positionInput: string, tier: RecPackageTier): number {
  const position = normalizeRecOvrPosition(positionInput);
  return REC_ARCHETYPE_CP_BUDGET_DATA[position]?.[String(tier)] ?? 0;
}

/** A specific template by position/tier/archetypeKey, or null if not found (e.g. stale key). */
export function getRecArchetypeTemplate(
  positionInput: string,
  tier: RecPackageTier,
  archetypeKey: string,
): RecArchetypeTemplateRow | null {
  return getRecArchetypeTemplates(positionInput, tier).find((row) => row.archetypeKey === archetypeKey) ?? null;
}

export function listRecArchetypeTemplatePositions(): readonly RecOvrPosition[] {
  return Object.keys(REC_ARCHETYPE_TEMPLATE_DATA) as RecOvrPosition[];
}
