/**
 * REC custom-player creation-point, ceiling, support-gate, archetype-identity,
 * and raw-OVR validator. This is the authoritative shared evaluator for client
 * previews and server-side acceptance.
 */
import {
  estimateRecPlayerOverall,
  normalizeRecOvrPosition,
  REC_POSITION_OVR_MODELS,
  type RecOvrPosition,
  type RecPlayerAttributes,
} from "./ovr-model.js";
import {
  evaluateRecArchetypeIdentity,
  getRecArchetype,
  getRecArchetypeCostMultiplier,
  REC_ARCHETYPE_CATALOG,
  type RecGameFamily,
  type RecPackageTier,
} from "./archetypes.js";

export const REC_BUILD_RULES_VERSION = "rec-custom-player-rules-v1.1.0" as const;

export interface RecPackageRules {
  tier: RecPackageTier;
  baseCalibrationCp: number;
  creationPoints: number;
  rawOverallCap: number;
  highImpactAttributeCap: number;
}

/**
 * creationPoints includes the empirical p90 archetype-premium adjustment.
 * The previous 4,600/5,100/5,800/6,700/7,700 values remain recorded as
 * baseCalibrationCp for auditability.
 */
export const REC_PACKAGE_RULES: Readonly<Record<RecPackageTier, RecPackageRules>> = {
  1: { tier: 1, baseCalibrationCp: 4600, creationPoints: 5000, rawOverallCap: 65, highImpactAttributeCap: 88 },
  2: { tier: 2, baseCalibrationCp: 5100, creationPoints: 5600, rawOverallCap: 71, highImpactAttributeCap: 91 },
  3: { tier: 3, baseCalibrationCp: 5800, creationPoints: 6300, rawOverallCap: 78, highImpactAttributeCap: 94 },
  4: { tier: 4, baseCalibrationCp: 6700, creationPoints: 7300, rawOverallCap: 84, highImpactAttributeCap: 97 },
  5: { tier: 5, baseCalibrationCp: 7700, creationPoints: 8500, rawOverallCap: 88, highImpactAttributeCap: 99 },
} as const;

export const REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS: Readonly<Record<string, number>> = {
  spd: 2.10,
  thp: 2.00,
  acc: 1.85,
  cod: 1.75,
  agi: 1.65,
  str: 1.65,
  kpw: 1.55,
  pow: 1.45,
  jmp: 1.35,
} as const;

export const REC_SUPPORT_UNLOCKS = [
  { minimumRequestedRating: 95, requiredSupportIndex: 82, minimumPrimarySkill: 65 },
  { minimumRequestedRating: 90, requiredSupportIndex: 75, minimumPrimarySkill: 60 },
  { minimumRequestedRating: 85, requiredSupportIndex: 68, minimumPrimarySkill: 55 },
  { minimumRequestedRating: 80, requiredSupportIndex: 62, minimumPrimarySkill: 50 },
] as const;

export type RecBuildViolationCode =
  | "UNSUPPORTED_ATTRIBUTE"
  | "INVALID_RATING"
  | "INSUFFICIENT_POINTS"
  | "PACKAGE_ATTRIBUTE_CAP"
  | "SUPPORT_INDEX_TOO_LOW"
  | "PRIMARY_SKILL_FLOOR"
  | "ARCHETYPE_IDENTITY"
  | "OVR_CAP_EXCEEDED";

export interface RecBuildViolation {
  code: RecBuildViolationCode;
  message: string;
  attribute?: string;
  requestedRating?: number;
  current?: number;
  required?: number;
  deficientAttributes?: Array<{ attribute: string; current: number; required: number }>;
}

export interface RecSupportResult {
  applicable: boolean;
  supportIndex: number;
  requiredSupportIndex: number;
  minimumPrimarySkill: number;
  deficientPrimaryAttributes: Array<{ attribute: string; current: number; required: number }>;
}

export interface RecBuildEvaluationInput {
  game: RecGameFamily;
  position: string;
  archetypeKey: string;
  packageTier: RecPackageTier;
  attributes: RecPlayerAttributes;
  netDevelopmentCost: number;
  mode?: "preview" | "submit";
}

export interface RecBuildEvaluationResult {
  valid: boolean;
  rulesVersion: typeof REC_BUILD_RULES_VERSION;
  position: RecOvrPosition;
  attributeCost: number;
  netDevelopmentCost: number;
  totalCost: number;
  creationPoints: number;
  pointsRemaining: number;
  rawOverall: number;
  displayOverall: number;
  linearScore: number;
  confidence: number;
  ovrModelVersion: string;
  rawOverallCap: number;
  archetypeIdentity: ReturnType<typeof evaluateRecArchetypeIdentity>;
  violations: RecBuildViolation[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

function normalizeRecAttributeMap(attributes: RecPlayerAttributes): RecPlayerAttributes {
  const normalized: RecPlayerAttributes = {};
  for (const [attribute, value] of Object.entries(attributes)) {
    normalized[attribute.trim().toLowerCase()] = value;
  }
  return normalized;
}

export function recBaseMarginalCost(destinationRating: number): number {
  const rating = Math.trunc(destinationRating);
  if (rating < 1 || rating > 99) {
    throw new Error(`Destination rating must be 1-99: ${destinationRating}`);
  }
  if (rating <= 49) return 1;
  if (rating <= 59) return 2;
  if (rating <= 69) return 3;
  if (rating <= 79) return 5;
  if (rating <= 84) return 8;
  if (rating <= 89) return 12;
  if (rating <= 94) return 18;
  return 28;
}

export function getRecPositionAttributeWeight(
  positionInput: string,
  attributeCode: string
): number {
  const position = normalizeRecOvrPosition(positionInput);
  const coefficients = REC_POSITION_OVR_MODELS[position].coefficients;
  const values = Object.values(coefficients);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const coefficient = coefficients[attributeCode.trim().toLowerCase()];
  if (coefficient === undefined) return 1;
  return clamp(coefficient / mean, 0.75, 1.50);
}

export function getRecEffectiveAttributeMultiplier(
  game: RecGameFamily,
  positionInput: string,
  archetypeKey: string,
  attributeCode: string
): number {
  const code = attributeCode.trim().toLowerCase();
  const positionWeight = getRecPositionAttributeWeight(positionInput, code);
  const gameplayMinimum = REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS[code] ?? 1;
  const archetypeWeight = getRecArchetypeCostMultiplier(
    game,
    positionInput,
    archetypeKey,
    code
  );
  return Math.max(positionWeight, gameplayMinimum) * archetypeWeight;
}

export function calculateRecAttributeCost(
  game: RecGameFamily,
  positionInput: string,
  archetypeKey: string,
  attributeCode: string,
  destinationRating: number
): number {
  const rating = clamp(Math.trunc(destinationRating), 0, 99);
  const multiplier = getRecEffectiveAttributeMultiplier(
    game,
    positionInput,
    archetypeKey,
    attributeCode
  );
  let total = 0;
  for (let point = 1; point <= rating; point += 1) {
    total += Math.max(
      1,
      Math.round(recBaseMarginalCost(point) * multiplier)
    );
  }
  return total;
}

/**
 * Editable fields are position-wide. They are the union of every approved
 * archetype field for the position plus every position OVR field. Selecting a
 * new archetype therefore never deletes or hard-locks legitimate attributes.
 */
export function getRecEditableAttributes(
  game: RecGameFamily,
  positionInput: string,
  _archetypeKey?: string
): readonly string[] {
  const position = normalizeRecOvrPosition(positionInput);
  const positionArchetypes = REC_ARCHETYPE_CATALOG[game][position];
  return [...new Set([
    ...Object.keys(REC_POSITION_OVR_MODELS[position].coefficients),
    ...positionArchetypes.flatMap((archetype) => [
      ...archetype.primaryAttributes,
      ...archetype.secondaryAttributes,
    ]),
  ])].sort();
}

export function calculateRecBuildAttributeCost(
  input: Omit<RecBuildEvaluationInput, "netDevelopmentCost">
): number {
  const editable = getRecEditableAttributes(
    input.game,
    input.position,
    input.archetypeKey
  );
  const attributes = normalizeRecAttributeMap(input.attributes);
  return editable.reduce((total, attribute) => {
    const raw = attributes[attribute];
    const rating =
      typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    return total + calculateRecAttributeCost(
      input.game,
      input.position,
      input.archetypeKey,
      attribute,
      rating
    );
  }, 0);
}

function weightedMean(entries: Array<{ value: number; weight: number }>): number {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return totalWeight > 0
    ? entries.reduce(
        (sum, entry) => sum + entry.value * entry.weight,
        0
      ) / totalWeight
    : 0;
}

export function evaluateRecSupportGate(
  game: RecGameFamily,
  positionInput: string,
  archetypeKey: string,
  targetAttribute: string,
  requestedRating: number,
  attributesInput: RecPlayerAttributes
): RecSupportResult {
  const code = targetAttribute.trim().toLowerCase();
  const unlock = REC_SUPPORT_UNLOCKS.find(
    (rule) => requestedRating >= rule.minimumRequestedRating
  );
  if (!unlock || REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS[code] === undefined) {
    return {
      applicable: false,
      supportIndex: 0,
      requiredSupportIndex: 0,
      minimumPrimarySkill: 0,
      deficientPrimaryAttributes: [],
    };
  }

  const attributes = normalizeRecAttributeMap(attributesInput);
  const archetype = getRecArchetype(game, positionInput, archetypeKey);
  const supportCodes = [
    ...new Set([
      ...archetype.primaryAttributes,
      ...archetype.secondaryAttributes,
    ]),
  ].filter((attribute) => attribute !== code);

  const entries = supportCodes.map((attribute) => {
    const raw = attributes[attribute];
    const value =
      typeof raw === "number" && Number.isFinite(raw)
        ? clamp(raw, 0, 99)
        : 0;
    const weight = archetype.primaryAttributes.includes(attribute) ? 1 : 0.75;
    return { attribute, value, weight };
  });

  const mean = weightedMean(entries);
  const lowerCount = Math.max(1, Math.ceil(entries.length / 4));
  const lowerQuartile = weightedMean(
    [...entries].sort((a, b) => a.value - b.value).slice(0, lowerCount)
  );
  const supportIndex = round2(0.70 * mean + 0.30 * lowerQuartile);

  const deficientPrimaryAttributes = archetype.primaryAttributes
    .filter((attribute) => attribute !== code)
    .map((attribute) => {
      const raw = attributes[attribute];
      const current =
        typeof raw === "number" && Number.isFinite(raw)
          ? clamp(raw, 0, 99)
          : 0;
      return {
        attribute,
        current,
        required: unlock.minimumPrimarySkill,
      };
    })
    .filter((entry) => entry.current < entry.required);

  return {
    applicable: true,
    supportIndex,
    requiredSupportIndex: unlock.requiredSupportIndex,
    minimumPrimarySkill: unlock.minimumPrimarySkill,
    deficientPrimaryAttributes,
  };
}

function validateHighImpactAttributes(
  input: RecBuildEvaluationInput
): RecBuildViolation[] {
  const packageRules = REC_PACKAGE_RULES[input.packageTier];
  const attributes = normalizeRecAttributeMap(input.attributes);
  const violations: RecBuildViolation[] = [];

  for (const attribute of Object.keys(REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS)) {
    const raw = attributes[attribute];
    const rating =
      typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;

    if (rating > packageRules.highImpactAttributeCap) {
      violations.push({
        code: "PACKAGE_ATTRIBUTE_CAP",
        attribute,
        requestedRating: rating,
        current: rating,
        required: packageRules.highImpactAttributeCap,
        message:
          `${attribute.toUpperCase()} ${rating} exceeds the Tier ` +
          `${input.packageTier} high-impact cap of ` +
          `${packageRules.highImpactAttributeCap}.`,
      });
    }

    const support = evaluateRecSupportGate(
      input.game,
      input.position,
      input.archetypeKey,
      attribute,
      rating,
      attributes
    );

    if (support.applicable && support.supportIndex < support.requiredSupportIndex) {
      violations.push({
        code: "SUPPORT_INDEX_TOO_LOW",
        attribute,
        requestedRating: rating,
        current: support.supportIndex,
        required: support.requiredSupportIndex,
        message:
          `${attribute.toUpperCase()} ${rating} requires a support index of ` +
          `${support.requiredSupportIndex}; current ${support.supportIndex}.`,
      });
    }

    if (support.applicable && support.deficientPrimaryAttributes.length > 0) {
      violations.push({
        code: "PRIMARY_SKILL_FLOOR",
        attribute,
        requestedRating: rating,
        deficientAttributes: support.deficientPrimaryAttributes,
        message:
          `${attribute.toUpperCase()} ${rating} requires every other primary ` +
          `archetype skill to meet the ${support.minimumPrimarySkill} floor.`,
      });
    }
  }

  return violations;
}

export function evaluateRecCustomPlayerBuild(
  input: RecBuildEvaluationInput
): RecBuildEvaluationResult {
  const position = normalizeRecOvrPosition(input.position);
  const packageRules = REC_PACKAGE_RULES[input.packageTier];
  const attributes = normalizeRecAttributeMap(input.attributes);
  const normalizedInput: RecBuildEvaluationInput = {
    ...input,
    position,
    attributes,
  };
  const violations: RecBuildViolation[] = [];
  const editable = new Set(
    getRecEditableAttributes(input.game, position, input.archetypeKey)
  );

  for (const [attribute, raw] of Object.entries(attributes)) {
    if (!editable.has(attribute) && typeof raw === "number" && raw !== 0) {
      violations.push({
        code: "UNSUPPORTED_ATTRIBUTE",
        attribute,
        message: `${attribute} is not editable for ${position}.`,
      });
    }
    if (
      typeof raw === "number" &&
      (!Number.isFinite(raw) || raw < 0 || raw > 99 || !Number.isInteger(raw))
    ) {
      violations.push({
        code: "INVALID_RATING",
        attribute,
        requestedRating: raw,
        message: `${attribute} must be an integer from 0 through 99.`,
      });
    }
  }

  violations.push(...validateHighImpactAttributes(normalizedInput));

  const attributeCost = calculateRecBuildAttributeCost(normalizedInput);
  const netDevelopmentCost = Math.max(
    0,
    Math.trunc(input.netDevelopmentCost)
  );
  const totalCost = attributeCost + netDevelopmentCost;
  if (totalCost > packageRules.creationPoints) {
    violations.push({
      code: "INSUFFICIENT_POINTS",
      current: totalCost,
      required: packageRules.creationPoints,
      message:
        `Build costs ${totalCost} CP but the package provides ` +
        `${packageRules.creationPoints} CP.`,
    });
  }

  const archetypeIdentity = evaluateRecArchetypeIdentity(
    input.game,
    position,
    input.archetypeKey,
    input.packageTier,
    attributes
  );
  if ((input.mode ?? "submit") === "submit" && !archetypeIdentity.valid) {
    violations.push({
      code: "ARCHETYPE_IDENTITY",
      current: archetypeIdentity.primaryAverage,
      required: archetypeIdentity.requiredPrimaryAverage,
      deficientAttributes: archetypeIdentity.deficientPrimaryAttributes,
      message:
        `${input.archetypeKey} requires a primary average of ` +
        `${archetypeIdentity.requiredPrimaryAverage} and permits at most one ` +
        `primary attribute below ` +
        `${archetypeIdentity.lowestPermittedPrimaryRating}.`,
    });
  }

  const overall = estimateRecPlayerOverall(position, attributes);
  if (overall.rawOverall > packageRules.rawOverallCap + 1e-9) {
    violations.push({
      code: "OVR_CAP_EXCEEDED",
      current: overall.rawOverall,
      required: packageRules.rawOverallCap,
      message:
        `Raw OVR ${overall.rawOverall} exceeds the Tier ` +
        `${input.packageTier} cap of ${packageRules.rawOverallCap}.`,
    });
  }

  return {
    valid: violations.length === 0,
    rulesVersion: REC_BUILD_RULES_VERSION,
    position,
    attributeCost,
    netDevelopmentCost,
    totalCost,
    creationPoints: packageRules.creationPoints,
    pointsRemaining: packageRules.creationPoints - totalCost,
    rawOverall: overall.rawOverall,
    displayOverall: overall.displayOverall,
    linearScore: overall.linearScore,
    confidence: overall.confidence,
    ovrModelVersion: overall.modelVersion,
    rawOverallCap: packageRules.rawOverallCap,
    archetypeIdentity,
    violations,
  };
}

export interface RecAttributeChangeInput extends RecBuildEvaluationInput {
  attribute: string;
  proposedRating: number;
}

/**
 * Preview mode reports archetype identity progress but does not block every
 * intermediate increment merely because the final identity floor is not met.
 */
export function evaluateRecProposedAttributeChange(
  input: RecAttributeChangeInput
): RecBuildEvaluationResult {
  return evaluateRecCustomPlayerBuild({
    ...input,
    mode: "preview",
    attributes: {
      ...input.attributes,
      [input.attribute.trim().toLowerCase()]: input.proposedRating,
    },
  });
}
