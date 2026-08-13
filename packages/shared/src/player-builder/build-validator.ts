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
  getRecAllAttributeCodes,
  getRecArchetypeCostMultiplier,
  type RecGameFamily,
  type RecPackageTier,
} from "./archetypes.js";

// v1.3.0: attribute-cost floor raised 0.75->0.90 (no attribute is "nearly free" to max
// regardless of position relevance), and relational floor/ceiling gating extended from the
// original 9 high-impact attributes to ~34 (coverage, tackling, blocking, pass rush, route
// running, catching, ball-carrier) — both aimed at the same problem: leftover CP getting
// dumped into OVR-irrelevant attributes at 99 with no real cost or prerequisite.
// v1.5.0: even with the 35-attribute floor (v1.4.1), a Tier 5 build could still push several
// position-relevant attributes into the high 90s within budget — recBaseMarginalCost's high
// end wasn't steep enough, and the position-weight ceiling (1.50x) and high-impact multipliers
// undersold how expensive a truly elite attribute should be. Both raised so 90+ costs real CP
// and 95+ costs a lot more, especially for the attributes that actually matter at a position.
// v1.5.1: v1.5.0 overshot — a Tier 5 purchase (the most expensive package) came out to a 54
// OVR SS with low attributes across the board, meaning the mandatory 35-point floor across
// all 53 attributes was eating nearly the entire budget before a build could specialize at
// all. Dialed the same three levers back roughly halfway between v1.4 and v1.5.0.
// v1.6.0: package CP allowances increased 15% after position-spanning allocator calibration
// showed the top tier still plateauing around 84-85 OVR for QB/WR builds. OVR and attribute
// caps remain unchanged, adding flexibility without permitting a stronger final player.
export const REC_BUILD_RULES_VERSION = "rec-custom-player-rules-v1.6.0" as const;

export interface RecPackageRules {
  tier: RecPackageTier;
  baseCalibrationCp: number;
  creationPoints: number;
  rawOverallCap: number;
  highImpactAttributeCap: number;
}

/**
 * baseCalibrationCp preserves the original empirical calibration. creationPoints now gives
 * each tier 15% more than its prior allowance after position-spanning checks showed that the
 * most expensive QB and WR builds still stopped several OVR below their advertised ceiling.
 * The independent OVR and high-impact attribute caps continue to enforce package strength.
 */
export const REC_PACKAGE_RULES: Readonly<Record<RecPackageTier, RecPackageRules>> = {
  // Authoritative custom-player OVR caps (old live 65/71/78/84/88 retired in v1.5.0).
  1: { tier: 1, baseCalibrationCp: 4600, creationPoints: 4495, rawOverallCap: 63, highImpactAttributeCap: 88 },
  2: { tier: 2, baseCalibrationCp: 5100, creationPoints: 4985, rawOverallCap: 68, highImpactAttributeCap: 91 },
  3: { tier: 3, baseCalibrationCp: 5800, creationPoints: 5670, rawOverallCap: 73, highImpactAttributeCap: 94 },
  4: { tier: 4, baseCalibrationCp: 6700, creationPoints: 6550, rawOverallCap: 77, highImpactAttributeCap: 97 },
  5: { tier: 5, baseCalibrationCp: 7700, creationPoints: 7525, rawOverallCap: 81, highImpactAttributeCap: 99 },
} as const;

// No more archetype picker — every editable attribute on every build, regardless of tier,
// starts here and can never be lowered. The starting CP cost of every attribute sitting at
// this floor comes out of the package's budget before the user allocates anything further
// (cost is derived from the final value, so pre-filling to this floor already "spends" it).
export const REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR = 35;

export const REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS: Readonly<Record<string, number>> = {
  spd: 2.30,
  thp: 2.20,
  acc: 2.05,
  cod: 1.95,
  agi: 1.85,
  str: 1.80,
  kpw: 1.70,
  pow: 1.60,
  jmp: 1.50,
} as const;

// A gated attribute's ceiling rises in tiers — to push past `minimumRequestedRating - 1`,
// every one of that attribute's related attributes (below) must already be at least
// `requiredFloor`. Checked from highest tier down so the message always names the single
// next threshold the player needs to clear, not every tier at once.
export const REC_ATTRIBUTE_CEILING_TIERS = [
  { minimumRequestedRating: 95, requiredFloor: 80 },
  { minimumRequestedRating: 90, requiredFloor: 70 },
  { minimumRequestedRating: 85, requiredFloor: 60 },
  { minimumRequestedRating: 80, requiredFloor: 50 },
] as const;

// Logical, position-agnostic pairings — every one of the 53 attribute codes is editable
// for every position (getRecEditableAttributes returns the full set regardless of position),
// so these floors are always satisfiable no matter what the player is. Keeps a build from
// pumping one number (e.g. Speed) while everything that would realistically make that
// number possible (Agility, Change of Direction, Acceleration) stays untouched.
//
// Originally covered only the 9 REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS attributes — every
// other editable attribute (coverage, tackling, blocking, pass rush, route running,
// catching) had zero relational gating, constrained only by raw CP cost. Combined with
// low-coefficient attributes being cheap to buy (see getRecPositionAttributeWeight), that
// let a build max out several OVR-irrelevant attributes with leftover CP once its primary
// stats and OVR cap were already satisfied — an OVR-legal player with a handful of
// unrelated 90s+ ratings that don't look like a real player. This extension requires a
// believable supporting attribute (mental processing via Awareness, or the physical
// tool the skill actually depends on) before the gated attribute can run high, the same
// way the original 9 already required for Speed/Throw Power/etc.
export const REC_ATTRIBUTE_FLOOR_RELATIONS: Readonly<Record<string, readonly string[]>> = {
  spd: ["agi", "cod", "acc"],
  acc: ["spd", "agi"],
  agi: ["cod", "acc"],
  cod: ["agi", "acc"],
  str: ["tou"],
  jmp: ["agi", "str"],
  thp: ["str"],
  kpw: ["str"],
  pow: ["awr", "str"],
  // Coverage — reading the play matters as much as raw hips/change of direction.
  mcv: ["awr", "agi"],
  zcv: ["awr", "prc"],
  prc: ["awr"],
  prs: ["awr", "agi"],
  // Tackling / pass rush — technique (Awareness) plus the physical tool.
  tak: ["awr", "str"],
  bsh: ["awr", "str"],
  pmv: ["str", "awr"],
  fmv: ["agi", "awr"],
  pur: ["awr", "spd"],
  // Blocking — a lineman's hands/technique need Strength and Awareness behind them.
  pbk: ["awr", "str"],
  pbp: ["str"],
  pbf: ["agi", "awr"],
  rbk: ["awr", "str"],
  rbp: ["str"],
  rbf: ["agi", "awr"],
  ibl: ["awr", "str"],
  lbk: ["awr", "str"],
  // Route running / receiving — Awareness (reads the defense) and Agility (separation).
  srr: ["awr", "agi"],
  mrr: ["awr", "agi"],
  drr: ["awr", "spd"],
  cth: ["awr"],
  cit: ["awr", "str"],
  spc: ["jmp", "agi"],
  // Ball carrier — vision/protection need Awareness/Strength behind the raw move.
  bcv: ["awr"],
  btk: ["str", "tou"],
  trk: ["str"],
} as const;

// Position-aware cap on how far the speed/quick package may spread. Once any of SPD, AGI,
// ACC, or COD reaches REC_QUICK_CLUSTER_GAP_THRESHOLD, the whole cluster must stay within
// REC_POSITION_QUICK_CLUSTER_GAP[position] points of each other. Positions that depend on
// quickness (WR, CB, HB) keep the four close together — a WR with 89 SPD has no business at
// 60 AGI — while positions where straight-line speed can carry a player (TE, OL, DL) allow a
// wider spread. The threshold sits above every archetype baseline (primary attributes start
// at the tier identity floor, max 70 on tier 5), so picking an archetype never trips the rule
// before the user actually builds speed.
export const REC_QUICK_CLUSTER_ATTRIBUTES = ["spd", "agi", "acc", "cod"] as const;
export const REC_QUICK_CLUSTER_GAP_THRESHOLD = 75;
export const REC_POSITION_QUICK_CLUSTER_GAP: Readonly<Partial<Record<RecOvrPosition, number>>> = {
  WR: 14, CB: 14, HB: 16,
  FS: 18, SS: 18,
  ROLB: 20, LOLB: 20, MLB: 20,
  QB: 24,
  TE: 26, FB: 26, LE: 28, RE: 28,
  DT: 30, LT: 32, LG: 32, C: 32, RG: 32, RT: 32,
};

export type RecBuildViolationCode =
  | "UNSUPPORTED_ATTRIBUTE"
  | "INVALID_RATING"
  | "INSUFFICIENT_POINTS"
  | "PACKAGE_ATTRIBUTE_CAP"
  | "ATTRIBUTE_FLOOR_REQUIRED"
  | "QUICK_CLUSTER_GAP"
  | "ARCHETYPE_IDENTITY"
  | "OVR_CAP_EXCEEDED";

export interface RecBuildViolation {
  code: RecBuildViolationCode;
  message: string;
  attribute?: string;
  requestedRating?: number;
  current?: number;
  required?: number;
  ceilingRating?: number;
  deficientAttributes?: Array<{ attribute: string; current: number; required: number }>;
}

export interface RecAttributeCeilingResult {
  applicable: boolean;
  requiredFloor: number;
  ceilingRating: number;
  deficientAttributes: Array<{ attribute: string; current: number; required: number }>;
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
  if (rating <= 84) return 11;
  if (rating <= 89) return 17;
  if (rating <= 94) return 30;
  if (rating <= 97) return 75;
  return 160;
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
  // Floor raised from 0.75 — an attribute the OVR model barely weights for this position
  // was previously up to 25% cheaper than an average-importance one, on top of already
  // being nearly free to max since it moves OVR/the raw-overall cap so little. That gap is
  // exactly what let leftover CP get dumped into unrelated attributes at 99 with no real
  // cost, producing OVR-capped players with several unrelated maxed-out ratings.
  // Ceiling raised 1.50->1.65 (v1.5.1, dialed back from v1.5.0's 1.85) — the attributes the
  // OVR model actually weights heavily for a position are exactly the ones a build wants at
  // elite ratings; undercharging them relative to the average let a build reach the high 90s
  // in several of them at once while staying under the tier's CP budget.
  return clamp(coefficient / mean, 0.90, 1.65);
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
 * A custom player must have every one of the 53 attributes set, not just the ones relevant
 * to their position/archetype — getRecArchetypeCostMultiplier already prices irrelevant
 * attributes lower (REC_ARCHETYPE_COST_MULTIPLIERS.irrelevant) rather than excluding them, so
 * "editable" is simply every attribute code. Game/position/archetype are kept as parameters
 * (unused) so existing call sites don't need to change.
 */
export function getRecEditableAttributes(
  _game: RecGameFamily,
  _positionInput: string,
  _archetypeKey?: string
): readonly string[] {
  return getRecAllAttributeCodes();
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

/** Checks whether `targetAttribute` can reach `requestedRating` given its related
 * attributes' current values — logical (Speed needs Agility/COD/Acceleration, Throw Power
 * needs Strength), not archetype-derived, so the requirement is stable and explainable
 * regardless of which archetype the build ends up matching. */
export function evaluateRecAttributeCeiling(
  targetAttribute: string,
  requestedRating: number,
  attributesInput: RecPlayerAttributes
): RecAttributeCeilingResult {
  const code = targetAttribute.trim().toLowerCase();
  const related = REC_ATTRIBUTE_FLOOR_RELATIONS[code];
  const tier = REC_ATTRIBUTE_CEILING_TIERS.find(
    (rule) => requestedRating >= rule.minimumRequestedRating
  );
  if (!related || !tier) {
    return { applicable: false, requiredFloor: 0, ceilingRating: 0, deficientAttributes: [] };
  }

  const attributes = normalizeRecAttributeMap(attributesInput);
  const deficientAttributes = related
    .map((attribute) => {
      const raw = attributes[attribute];
      const current =
        typeof raw === "number" && Number.isFinite(raw)
          ? clamp(raw, 0, 99)
          : 0;
      return { attribute, current, required: tier.requiredFloor };
    })
    .filter((entry) => entry.current < entry.required);

  return {
    applicable: true,
    requiredFloor: tier.requiredFloor,
    ceilingRating: tier.minimumRequestedRating,
    deficientAttributes,
  };
}

function validateHighImpactAttributes(
  input: RecBuildEvaluationInput
): RecBuildViolation[] {
  const packageRules = REC_PACKAGE_RULES[input.packageTier];
  const attributes = normalizeRecAttributeMap(input.attributes);
  const violations: RecBuildViolation[] = [];

  // Package's hard high-impact numeric cap — scoped to the original 9 "obviously game-
  // breaking at 99" attributes (Speed, Throw Power, etc.), not every gated attribute below.
  for (const attribute of Object.keys(REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS)) {
    const raw = attributes[attribute];
    const rating =
      typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
    if (rating <= packageRules.highImpactAttributeCap) continue;

    const ceiling = evaluateRecAttributeCeiling(attribute, rating, attributes);
    // Distinct from the ATTRIBUTE_FLOOR_REQUIRED message: this one is about the package's
    // hard high-impact ceiling, and it names the concrete path when one exists — the gated
    // attribute's related quickness stats (ACC/AGI/COD, etc.) must reach the floor of the
    // next ceiling tier before running the attribute anywhere near the cap.
    const path =
      ceiling.applicable && ceiling.deficientAttributes.length > 0
        ? ` To run ${attribute.toUpperCase()} at the cap, ` +
          `${ceiling.deficientAttributes.map((entry) => entry.attribute.toUpperCase()).join(", ")} ` +
          `${ceiling.deficientAttributes.length === 1 ? "must reach" : "must each reach"} ` +
          `at least ${ceiling.requiredFloor}.`
        : ` Lower ${attribute.toUpperCase()} to ${packageRules.highImpactAttributeCap} or below.`;
    violations.push({
      code: "PACKAGE_ATTRIBUTE_CAP",
      attribute,
      requestedRating: rating,
      current: rating,
      required: packageRules.highImpactAttributeCap,
      message:
        `${attribute.toUpperCase()} ${rating} exceeds the Tier ` +
        `${input.packageTier} high-impact cap of ` +
        `${packageRules.highImpactAttributeCap}.${path}`,
    });
  }

  // Relational floor/ceiling gating — every attribute in REC_ATTRIBUTE_FLOOR_RELATIONS
  // (the original 9 high-impact ones plus the broader set covering coverage, tackling,
  // blocking, pass rush, route running, and catching), not just the high-impact 9. This is
  // what actually stops a build from maxing an unrelated attribute with leftover CP once
  // its primary stats and OVR cap are already satisfied.
  for (const attribute of Object.keys(REC_ATTRIBUTE_FLOOR_RELATIONS)) {
    const raw = attributes[attribute];
    const rating =
      typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const ceiling = evaluateRecAttributeCeiling(attribute, rating, attributes);
    if (ceiling.applicable && ceiling.deficientAttributes.length > 0) {
      violations.push({
        code: "ATTRIBUTE_FLOOR_REQUIRED",
        attribute,
        requestedRating: rating,
        required: ceiling.requiredFloor,
        ceilingRating: ceiling.ceilingRating,
        deficientAttributes: ceiling.deficientAttributes,
        message:
          `${attribute.toUpperCase()} is capped at ${ceiling.ceilingRating - 1} until ` +
          `${ceiling.deficientAttributes.map((entry) => entry.attribute.toUpperCase()).join(", ")} ` +
          `${ceiling.deficientAttributes.length === 1 ? "reaches" : "each reach"} at least ${ceiling.requiredFloor}.`,
      });
    }
  }

  return violations;
}

function validateQuickClusterGap(
  position: RecOvrPosition,
  attributes: RecPlayerAttributes
): RecBuildViolation[] {
  const maxGap = REC_POSITION_QUICK_CLUSTER_GAP[position];
  if (maxGap === undefined) return [];
  const ratings = REC_QUICK_CLUSTER_ATTRIBUTES.map((code) => {
    const raw = attributes[code];
    const rating = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
    return { code, rating };
  }).sort((a, b) => b.rating - a.rating);
  const highest = ratings[0]!;
  if (highest.rating < REC_QUICK_CLUSTER_GAP_THRESHOLD) return [];
  const lowest = ratings[ratings.length - 1]!;
  const spread = highest.rating - lowest.rating;
  if (spread <= maxGap) return [];
  const required = highest.rating - maxGap;
  return [{
    code: "QUICK_CLUSTER_GAP",
    attribute: highest.code,
    requestedRating: highest.rating,
    current: lowest.rating,
    required,
    deficientAttributes: [{ attribute: lowest.code, current: lowest.rating, required }],
    message:
      `${position} keeps Speed, Agility, Acceleration, and Change of Direction within ` +
      `${maxGap} points of each other once any reaches ${REC_QUICK_CLUSTER_GAP_THRESHOLD}+. ` +
      `${highest.code.toUpperCase()} ${highest.rating} vs ${lowest.code.toUpperCase()} ` +
      `${lowest.rating} is a ${spread}-point spread — raise ${lowest.code.toUpperCase()} to at ` +
      `least ${required} (or lower ${highest.code.toUpperCase()}).`,
  }];
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

  // Every editable attribute starts at REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR and can never drop
  // below it — there's no archetype picker anymore, so this replaces the old per-archetype
  // primary/secondary baseline as the one universal starting point, charged as CP the same
  // way any other point is (cost is derived from the final value, not from how you got
  // there). Only enforced at submit — preview stays lenient while the client is still
  // hydrating its defaults.
  if ((input.mode ?? "submit") === "submit") {
    for (const attribute of editable) {
      const raw = attributes[attribute];
      const rating = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      if (rating < REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR) {
        violations.push({
          code: "INVALID_RATING",
          attribute,
          requestedRating: rating,
          required: REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR,
          message: `${attribute} must be at least ${REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR} — every attribute starts there and can't be lowered.`,
        });
      }
    }
  }

  violations.push(...validateHighImpactAttributes(normalizedInput));
  violations.push(...validateQuickClusterGap(position, attributes));

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
