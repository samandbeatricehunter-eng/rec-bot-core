/**
 * Test helper: greedily spend a build's full CP budget on the cheapest legal attribute
 * increments available, respecting package caps, attribute floors, and quick-cluster gaps.
 * No longer targets an OVR estimate (see build-validator.ts REC_BUILD_RULES_VERSION v1.7.0) —
 * there's no cap to aim for anymore, so this just spends CP as far as it's able to go.
 */
import {
  normalizeRecOvrPosition,
  type RecPlayerAttributes,
} from "./ovr-model.js";
import { getRecAllAttributeCodes, type RecGameFamily, type RecPackageTier } from "./archetypes.js";
import { getRecArchetypeBonusCp, getRecArchetypeTemplate } from "./archetype-templates.js";
import {
  archetypeScaledHighImpactCap,
  effectiveRecAttributeFloor,
  evaluateRecAttributeCeiling,
  getRecEffectiveAttributeMultiplier,
  getRecEffectiveCreationPoints,
  REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS,
  REC_PACKAGE_RULES,
  REC_POSITION_QUICK_CLUSTER_GAP,
  REC_QUICK_CLUSTER_ATTRIBUTES,
  REC_QUICK_CLUSTER_GAP_THRESHOLD,
  recBaseMarginalCost,
} from "./build-validator.js";

export interface RecOptimalCpAllocationInput {
  game: RecGameFamily;
  position: string;
  archetypeKey: string;
  packageTier: RecPackageTier;
}

export interface RecOptimalCpAllocationResult {
  attributes: RecPlayerAttributes;
  attributeCost: number;
  creationPoints: number;
  pointsRemaining: number;
}

function ratingOf(attributes: RecPlayerAttributes, attribute: string): number {
  const raw = attributes[attribute];
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
}

function marginalPointCost(
  game: RecGameFamily,
  position: string,
  archetypeKey: string,
  attribute: string,
  destinationRating: number,
): number {
  const multiplier = getRecEffectiveAttributeMultiplier(game, position, archetypeKey, attribute);
  return Math.max(1, Math.round(recBaseMarginalCost(destinationRating) * multiplier));
}

function quickClusterOk(position: string, attributes: RecPlayerAttributes): boolean {
  const maxGap = REC_POSITION_QUICK_CLUSTER_GAP[normalizeRecOvrPosition(position)];
  if (maxGap === undefined) return true;
  const ratings = REC_QUICK_CLUSTER_ATTRIBUTES.map((code) => ratingOf(attributes, code));
  const highest = Math.max(...ratings);
  if (highest < REC_QUICK_CLUSTER_GAP_THRESHOLD) return true;
  return highest - Math.min(...ratings) <= maxGap;
}

function raiseIsLegal(
  game: RecGameFamily,
  packageTier: RecPackageTier,
  position: string,
  archetypeKey: string,
  attribute: string,
  nextRating: number,
  attributes: RecPlayerAttributes,
): boolean {
  const packageRules = REC_PACKAGE_RULES[packageTier];
  if (
    attribute in REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS &&
    nextRating > archetypeScaledHighImpactCap(game, position, archetypeKey, attribute, packageRules.highImpactAttributeCap)
  ) {
    return false;
  }
  const trial = { ...attributes, [attribute]: nextRating };
  const ceiling = evaluateRecAttributeCeiling(attribute, nextRating, trial);
  if (ceiling.applicable && ceiling.deficientAttributes.length > 0) return false;
  if (!quickClusterOk(position, trial)) return false;
  return true;
}

/**
 * Spend CP on the cheapest legal attribute increment first, across every editable attribute —
 * not just the ones relevant to the position/archetype, since there's no OVR target to chase
 * anymore. When a cheap attribute is blocked only by relational floors, raise the deficient
 * support attributes next so the build can keep spending toward its full budget.
 *
 * If this position/tier/archetype has a curated real-player template (Madden only — see
 * archetype-templates.ts), starts from its attributes (the floor, never lowered) and spends the
 * tier's bonus CP budget instead of the legacy flat-floor budget — same fallback rule as
 * build-validator.ts's evaluateRecCustomPlayerBuild.
 */
export function allocateRecOptimalCpForOvr(
  input: RecOptimalCpAllocationInput
): RecOptimalCpAllocationResult {
  const position = normalizeRecOvrPosition(input.position);
  const template = input.game === "MADDEN" ? getRecArchetypeTemplate(position, input.packageTier, input.archetypeKey) : null;
  const effectiveCreationPoints = template
    ? getRecArchetypeBonusCp(position, input.packageTier)
    : getRecEffectiveCreationPoints(position, input.packageTier);
  const pool = getRecAllAttributeCodes();
  // Non-template (CFB, or MADDEN with no curated archetype) builds still climb from an empty
  // seed the same way they always have -- the greedy loop below charges real CP for every point
  // raised, including 1-35, which is how this test helper's budget accounting has always worked
  // and matches getRecEffectiveCreationPoints (no separate pre-paid-floor budget for that path).
  // Only the template path needs the ≥35 clamp: a template's own attribute value becomes the
  // floor and is never charged for, so an unclamped sub-35 template value would seed (and let
  // the final build keep) a rating the real evaluator's floor check should have rejected.
  const attributes: RecPlayerAttributes = template
    ? Object.fromEntries(pool.map((attribute) => [attribute, effectiveRecAttributeFloor(template.attributes, attribute)]))
    : {};
  let spent = 0;

  for (let safety = 0; safety < 20_000; safety += 1) {
    type Candidate = { attribute: string; nextRating: number; cost: number };
    const candidates: Candidate[] = [];

    for (const attribute of pool) {
      const current = ratingOf(attributes, attribute);
      if (current >= 99) continue;
      const nextRating = current + 1;
      const cost = marginalPointCost(input.game, position, input.archetypeKey, attribute, nextRating);
      if (spent + cost > effectiveCreationPoints) continue;

      if (raiseIsLegal(input.game, input.packageTier, position, input.archetypeKey, attribute, nextRating, attributes)) {
        candidates.push({ attribute, nextRating, cost });
        continue;
      }

      const ceiling = evaluateRecAttributeCeiling(attribute, nextRating, { ...attributes, [attribute]: nextRating });
      if (!ceiling.applicable || ceiling.deficientAttributes.length === 0) continue;
      if (
        attribute in REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS &&
        nextRating > archetypeScaledHighImpactCap(input.game, position, input.archetypeKey, attribute, REC_PACKAGE_RULES[input.packageTier].highImpactAttributeCap)
      ) {
        continue;
      }

      for (const deficient of ceiling.deficientAttributes) {
        const supportAttr = deficient.attribute;
        const supportCurrent = ratingOf(attributes, supportAttr);
        if (supportCurrent >= 99 || supportCurrent >= deficient.required) continue;
        const supportNext = supportCurrent + 1;
        const supportCost = marginalPointCost(input.game, position, input.archetypeKey, supportAttr, supportNext);
        if (spent + supportCost > effectiveCreationPoints) continue;
        if (!raiseIsLegal(input.game, input.packageTier, position, input.archetypeKey, supportAttr, supportNext, attributes)) continue;
        candidates.push({ attribute: supportAttr, nextRating: supportNext, cost: supportCost });
      }
    }

    if (!candidates.length) break;
    candidates.sort(
      (a, b) => a.cost - b.cost || a.attribute.localeCompare(b.attribute),
    );
    const best = candidates[0]!;
    attributes[best.attribute] = best.nextRating;
    spent += best.cost;
  }

  return {
    attributes,
    attributeCost: spent,
    creationPoints: effectiveCreationPoints,
    pointsRemaining: effectiveCreationPoints - spent,
  };
}
