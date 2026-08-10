/**
 * Test helper: greedily allocate creation points to maximize estimated raw OVR
 * for a given game/position/archetype/package tier, respecting package caps,
 * attribute floors, quick-cluster gaps, and the tier rawOverallCap.
 */
import {
  estimateRecPlayerOverall,
  estimateRecPlayerOverallDelta,
  normalizeRecOvrPosition,
  REC_POSITION_OVR_MODELS,
  type RecPlayerAttributes,
} from "./ovr-model.js";
import {
  getRecArchetype,
  type RecGameFamily,
  type RecPackageTier,
} from "./archetypes.js";
import {
  evaluateRecAttributeCeiling,
  getRecEffectiveAttributeMultiplier,
  REC_ATTRIBUTE_FLOOR_RELATIONS,
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
  rawOverall: number;
  displayOverall: number;
  rawOverallCap: number;
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

function candidateAttributes(game: RecGameFamily, position: string, archetypeKey: string): string[] {
  const normalized = normalizeRecOvrPosition(position);
  const coeffs = Object.keys(REC_POSITION_OVR_MODELS[normalized].coefficients);
  const archetype = getRecArchetype(game, position, archetypeKey);
  const set = new Set<string>([
    ...coeffs,
    ...archetype.primaryAttributes,
    ...archetype.secondaryAttributes,
  ]);
  for (const attr of [...set]) {
    for (const related of REC_ATTRIBUTE_FLOOR_RELATIONS[attr] ?? []) set.add(related);
  }
  return [...set];
}

function raiseIsLegal(
  packageTier: RecPackageTier,
  position: string,
  attribute: string,
  nextRating: number,
  attributes: RecPlayerAttributes,
  rawOverallCap: number,
): boolean {
  const packageRules = REC_PACKAGE_RULES[packageTier];
  if (
    attribute in REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS &&
    nextRating > packageRules.highImpactAttributeCap
  ) {
    return false;
  }
  const trial = { ...attributes, [attribute]: nextRating };
  const ceiling = evaluateRecAttributeCeiling(attribute, nextRating, trial);
  if (ceiling.applicable && ceiling.deficientAttributes.length > 0) return false;
  if (!quickClusterOk(position, trial)) return false;
  if (estimateRecPlayerOverall(position, trial).rawOverall > rawOverallCap + 1e-9) return false;
  return true;
}

/**
 * Spend CP on the highest OVR-marginal legal attribute increments first.
 * When a high-value attribute is blocked only by relational floors, raise the
 * deficient support attributes next so the build can keep climbing toward the cap.
 */
export function allocateRecOptimalCpForOvr(
  input: RecOptimalCpAllocationInput
): RecOptimalCpAllocationResult {
  const position = normalizeRecOvrPosition(input.position);
  const packageRules = REC_PACKAGE_RULES[input.packageTier];
  const pool = candidateAttributes(input.game, position, input.archetypeKey);
  const attributes: RecPlayerAttributes = {};
  let spent = 0;

  for (let safety = 0; safety < 20_000; safety += 1) {
    type Candidate = { attribute: string; nextRating: number; cost: number; delta: number; score: number };
    const candidates: Candidate[] = [];

    for (const attribute of pool) {
      const current = ratingOf(attributes, attribute);
      if (current >= 99) continue;
      const nextRating = current + 1;
      const cost = marginalPointCost(input.game, position, input.archetypeKey, attribute, nextRating);
      if (spent + cost > packageRules.creationPoints) continue;

      if (raiseIsLegal(input.packageTier, position, attribute, nextRating, attributes, packageRules.rawOverallCap)) {
        const delta = estimateRecPlayerOverallDelta(position, attributes, attribute, nextRating).rawDelta;
        candidates.push({
          attribute,
          nextRating,
          cost,
          delta,
          score: delta > 0 ? delta / cost : 0,
        });
        continue;
      }

      const ceiling = evaluateRecAttributeCeiling(attribute, nextRating, { ...attributes, [attribute]: nextRating });
      if (!ceiling.applicable || ceiling.deficientAttributes.length === 0) continue;
      if (
        attribute in REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS &&
        nextRating > packageRules.highImpactAttributeCap
      ) {
        continue;
      }

      const coeff = REC_POSITION_OVR_MODELS[position].coefficients[attribute] ?? 0.01;
      for (const deficient of ceiling.deficientAttributes) {
        const supportAttr = deficient.attribute;
        const supportCurrent = ratingOf(attributes, supportAttr);
        if (supportCurrent >= 99 || supportCurrent >= deficient.required) continue;
        const supportNext = supportCurrent + 1;
        const supportCost = marginalPointCost(input.game, position, input.archetypeKey, supportAttr, supportNext);
        if (spent + supportCost > packageRules.creationPoints) continue;
        if (!raiseIsLegal(input.packageTier, position, supportAttr, supportNext, attributes, packageRules.rawOverallCap)) {
          continue;
        }
        const supportDelta = estimateRecPlayerOverallDelta(position, attributes, supportAttr, supportNext).rawDelta;
        candidates.push({
          attribute: supportAttr,
          nextRating: supportNext,
          cost: supportCost,
          delta: supportDelta,
          score: supportDelta > 0 ? supportDelta / supportCost : Math.max(coeff, 0.01) / supportCost / 1000,
        });
      }
    }

    if (!candidates.length) break;
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        b.delta - a.delta ||
        a.cost - b.cost ||
        a.attribute.localeCompare(b.attribute),
    );
    const best = candidates[0]!;
    if (best.delta <= 0 && best.score <= 0) break;
    attributes[best.attribute] = best.nextRating;
    spent += best.cost;
  }

  const overall = estimateRecPlayerOverall(position, attributes);
  return {
    attributes,
    attributeCost: spent,
    creationPoints: packageRules.creationPoints,
    pointsRemaining: packageRules.creationPoints - spent,
    rawOverall: overall.rawOverall,
    displayOverall: overall.displayOverall,
    rawOverallCap: packageRules.rawOverallCap,
  };
}