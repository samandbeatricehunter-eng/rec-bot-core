/**
 * REC Custom Player estimated OVR model.
 *
 * Model version: rec-ovr-cfb27-positional-v1.0.0
 * Calibration source: active CFB 27 baseline roster (11,728 players).
 *
 * This is an empirical REC estimator, not EA's undisclosed proprietary OVR formula.
 * CFB 27 and Madden 26/27 may share this version initially, but each game/year must
 * reference its own versioned configuration record so later recalibration is safe.
 */

export const REC_OVR_MODEL_VERSION = "rec-ovr-cfb27-positional-v1.0.0" as const;

export type RecOvrPosition =
  | "QB"
  | "HB"
  | "FB"
  | "WR"
  | "TE"
  | "LT"
  | "LG"
  | "C"
  | "RG"
  | "RT"
  | "LE"
  | "RE"
  | "DT"
  | "LOLB"
  | "MLB"
  | "ROLB"
  | "CB"
  | "FS"
  | "SS"
  | "K"
  | "P";

export type RecPlayerAttributes = Record<string, number | null | undefined>;

export interface RecPositionOvrValidation {
  trainN: number;
  testN: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  rSquared: number;
}

export interface RecPositionOvrModel {
  gamma: number;
  coefficients: Readonly<Record<string, number>>;
  validation: Readonly<RecPositionOvrValidation>;
}

export interface RecOverallResult {
  rawOverall: number;
  displayOverall: number;
  linearScore: number;
  confidence: number;
  missingAttributes: string[];
  position: RecOvrPosition;
  modelVersion: typeof REC_OVR_MODEL_VERSION;
}

export interface RecOverallDeltaResult {
  before: RecOverallResult;
  after: RecOverallResult;
  rawDelta: number;
  displayDelta: number;
}

export const REC_POSITION_ALIASES: Readonly<Record<string, RecOvrPosition>> = {
  QB: "QB",
  "QB (LEFT)": "QB",
  "QB (RIGHT)": "QB",
  HB: "HB",
  RB: "HB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  LT: "LT",
  LG: "LG",
  C: "C",
  RG: "RG",
  RT: "RT",
  LE: "LE",
  LEDG: "LE",
  RE: "RE",
  REDG: "RE",
  DT: "DT",
  LOLB: "LOLB",
  SAM: "LOLB",
  MLB: "MLB",
  MIKE: "MLB",
  ROLB: "ROLB",
  WILL: "ROLB",
  CB: "CB",
  FS: "FS",
  SS: "SS",
  K: "K",
  P: "P",
} as const;

export const REC_POSITION_OVR_MODELS: Readonly<
  Record<RecOvrPosition, RecPositionOvrModel>
> = {
  QB: {
    gamma: 1.30,
    coefficients: { acc: 0.028083, awr: 0.125266, bsk: 0.048211, cod: 0.028492, dac: 0.122948, mac: 0.15936, pac: 0.059371, run: 0.057974, sac: 0.13633, spd: 0.028067, thp: 0.123379, tup: 0.082519 },
    validation: {
      trainN: 470,
      testN: 129,
      meanAbsoluteError: 2.412,
      rootMeanSquaredError: 3.137,
      rSquared: 0.7428,
    },
  },
  HB: {
    gamma: 1.12,
    coefficients: { acc: 0.081443, agi: 0.063231, awr: 0.062462, bcv: 0.147065, btk: 0.100807, car: 0.135144, cod: 0.067919, cth: 0.025632, jkm: 0.076654, sfa: 0.034776, spd: 0.096148, spm: 0.056693, trk: 0.052027 },
    validation: {
      trainN: 604,
      testN: 152,
      meanAbsoluteError: 1.555,
      rootMeanSquaredError: 2.028,
      rSquared: 0.8376,
    },
  },
  FB: {
    gamma: 0.99,
    coefficients: { acc: 0.036508, awr: 0.078302, bcv: 0.083434, car: 0.110584, cth: 0.062831, ibl: 0.132756, lbk: 0.106928, rbk: 0.137507, sfa: 0.056105, spd: 0.042061, str: 0.09551, trk: 0.057476 },
    validation: {
      trainN: 20,
      testN: 3,
      meanAbsoluteError: 3.189,
      rootMeanSquaredError: 3.271,
      rSquared: 0.7781,
    },
  },
  WR: {
    gamma: 1.18,
    coefficients: { acc: 0.0729, agi: 0.0465, awr: 0.070336, cit: 0.100797, cod: 0.045145, cth: 0.152922, drr: 0.074766, mrr: 0.097164, rls: 0.081079, spc: 0.082444, spd: 0.090474, srr: 0.085473 },
    validation: {
      trainN: 995,
      testN: 250,
      meanAbsoluteError: 1.892,
      rootMeanSquaredError: 2.418,
      rSquared: 0.8603,
    },
  },
  TE: {
    gamma: 1.01,
    coefficients: { acc: 0.04044, awr: 0.075651, cit: 0.111895, cth: 0.130828, drr: 0.032399, ibl: 0.062192, lbk: 0.079471, mrr: 0.068263, rbk: 0.079859, rls: 0.055567, spc: 0.07099, spd: 0.064716, srr: 0.08105, str: 0.046679 },
    validation: {
      trainN: 609,
      testN: 147,
      meanAbsoluteError: 2.416,
      rootMeanSquaredError: 3.081,
      rSquared: 0.7769,
    },
  },
  LT: {
    gamma: 1.23,
    coefficients: { awr: 0.129266, ibl: 0.052146, lbk: 0.029672, pbf: 0.124698, pbk: 0.167317, pbp: 0.132553, rbf: 0.07955, rbk: 0.127702, rbp: 0.085556, str: 0.071541 },
    validation: {
      trainN: 410,
      testN: 94,
      meanAbsoluteError: 1.390,
      rootMeanSquaredError: 1.784,
      rSquared: 0.9263,
    },
  },
  LG: {
    gamma: 1.25,
    coefficients: { awr: 0.129203, ibl: 0.062723, lbk: 0.0198, pbf: 0.098772, pbk: 0.147671, pbp: 0.111214, rbf: 0.097364, rbk: 0.147845, rbp: 0.105211, str: 0.080197 },
    validation: {
      trainN: 381,
      testN: 97,
      meanAbsoluteError: 1.416,
      rootMeanSquaredError: 1.747,
      rSquared: 0.9392,
    },
  },
  C: {
    gamma: 1.30,
    coefficients: { awr: 0.153484, ibl: 0.050706, lbk: 0.019103, pbf: 0.10159, pbk: 0.161738, pbp: 0.105617, rbf: 0.091996, rbk: 0.149728, rbp: 0.093066, str: 0.072972 },
    validation: {
      trainN: 318,
      testN: 85,
      meanAbsoluteError: 1.540,
      rootMeanSquaredError: 1.925,
      rSquared: 0.9399,
    },
  },
  RG: {
    gamma: 1.25,
    coefficients: { awr: 0.132833, ibl: 0.063146, lbk: 0.019763, pbf: 0.094564, pbk: 0.147632, pbp: 0.114889, rbf: 0.091235, rbk: 0.147084, rbp: 0.107516, str: 0.081339 },
    validation: {
      trainN: 375,
      testN: 90,
      meanAbsoluteError: 1.517,
      rootMeanSquaredError: 1.890,
      rSquared: 0.8880,
    },
  },
  RT: {
    gamma: 1.23,
    coefficients: { awr: 0.132977, ibl: 0.06288, lbk: 0.030262, pbf: 0.090565, pbk: 0.140534, pbp: 0.120025, rbf: 0.093084, rbk: 0.151951, rbp: 0.097447, str: 0.080275 },
    validation: {
      trainN: 390,
      testN: 96,
      meanAbsoluteError: 1.481,
      rootMeanSquaredError: 1.786,
      rSquared: 0.9092,
    },
  },
  LE: {
    gamma: 1.12,
    coefficients: { acc: 0.077937, awr: 0.068335, bsh: 0.131308, fmv: 0.122511, pmv: 0.123879, pow: 0.062119, prc: 0.101881, pur: 0.088062, spd: 0.055675, str: 0.063337, tak: 0.104958 },
    validation: {
      trainN: 467,
      testN: 121,
      meanAbsoluteError: 1.572,
      rootMeanSquaredError: 1.858,
      rSquared: 0.8724,
    },
  },
  RE: {
    gamma: 1.11,
    coefficients: { acc: 0.072786, awr: 0.071642, bsh: 0.128924, fmv: 0.13155, pmv: 0.122168, pow: 0.059465, prc: 0.100192, pur: 0.086428, spd: 0.058129, str: 0.068669, tak: 0.100046 },
    validation: {
      trainN: 453,
      testN: 112,
      meanAbsoluteError: 1.776,
      rootMeanSquaredError: 2.150,
      rSquared: 0.8718,
    },
  },
  DT: {
    gamma: 1.15,
    coefficients: { acc: 0.034272, awr: 0.069892, bsh: 0.175684, fmv: 0.057527, pmv: 0.163278, pow: 0.083187, prc: 0.106802, pur: 0.063965, str: 0.109723, tak: 0.13567 },
    validation: {
      trainN: 708,
      testN: 184,
      meanAbsoluteError: 1.530,
      rootMeanSquaredError: 1.941,
      rSquared: 0.8882,
    },
  },
  LOLB: {
    gamma: 1.17,
    coefficients: { acc: 0.056567, agi: 0.030984, awr: 0.086415, bsh: 0.096129, fmv: 0.073334, mcv: 0.05783, pmv: 0.075431, pow: 0.04107, prc: 0.130904, pur: 0.100541, spd: 0.065091, tak: 0.134966, zcv: 0.050738 },
    validation: {
      trainN: 167,
      testN: 34,
      meanAbsoluteError: 2.249,
      rootMeanSquaredError: 2.848,
      rSquared: 0.7162,
    },
  },
  MLB: {
    gamma: 1.30,
    coefficients: { acc: 0.05765, agi: 0.031082, awr: 0.108318, bsh: 0.100348, cth: 0.038154, mcv: 0.055329, pow: 0.061189, prc: 0.14932, pur: 0.121706, spd: 0.063282, tak: 0.152115, zcv: 0.061506 },
    validation: {
      trainN: 470,
      testN: 124,
      meanAbsoluteError: 1.277,
      rootMeanSquaredError: 1.673,
      rSquared: 0.9375,
    },
  },
  ROLB: {
    gamma: 1.19,
    coefficients: { acc: 0.057231, agi: 0.031665, awr: 0.088392, bsh: 0.102147, fmv: 0.067089, mcv: 0.057309, pmv: 0.070269, pow: 0.041459, prc: 0.130074, pur: 0.101811, spd: 0.066619, tak: 0.136321, zcv: 0.049615 },
    validation: {
      trainN: 420,
      testN: 99,
      meanAbsoluteError: 1.780,
      rootMeanSquaredError: 2.249,
      rSquared: 0.8585,
    },
  },
  CB: {
    gamma: 1.16,
    coefficients: { acc: 0.073533, agi: 0.055478, awr: 0.085066, cod: 0.053554, cth: 0.044252, mcv: 0.172919, prc: 0.109074, prs: 0.102878, pur: 0.039975, spd: 0.091795, tak: 0.024961, zcv: 0.146514 },
    validation: {
      trainN: 814,
      testN: 223,
      meanAbsoluteError: 1.433,
      rootMeanSquaredError: 1.729,
      rSquared: 0.9295,
    },
  },
  FS: {
    gamma: 1.14,
    coefficients: { acc: 0.058959, agi: 0.035006, awr: 0.097103, cod: 0.032869, cth: 0.027158, mcv: 0.103361, pow: 0.036147, prc: 0.146386, prs: 0.050105, pur: 0.082163, spd: 0.069543, tak: 0.076331, zcv: 0.184869 },
    validation: {
      trainN: 483,
      testN: 104,
      meanAbsoluteError: 1.019,
      rootMeanSquaredError: 1.364,
      rSquared: 0.9483,
    },
  },
  SS: {
    gamma: 1.13,
    coefficients: { acc: 0.047864, agi: 0.032595, awr: 0.098994, cod: 0.030016, cth: 0.027169, mcv: 0.094172, pow: 0.065878, prc: 0.137425, prs: 0.049654, pur: 0.095303, spd: 0.057384, tak: 0.11028, zcv: 0.153265 },
    validation: {
      trainN: 447,
      testN: 110,
      meanAbsoluteError: 1.050,
      rootMeanSquaredError: 1.407,
      rSquared: 0.9492,
    },
  },
  K: {
    gamma: 1.23,
    coefficients: { awr: 0.083635, kac: 0.454038, kpw: 0.462327 },
    validation: {
      trainN: 216,
      testN: 53,
      meanAbsoluteError: 2.510,
      rootMeanSquaredError: 3.115,
      rSquared: 0.4713,
    },
  },
  P: {
    gamma: 1.26,
    coefficients: { awr: 0.089395, kac: 0.447492, kpw: 0.463113 },
    validation: {
      trainN: 165,
      testN: 39,
      meanAbsoluteError: 2.803,
      rootMeanSquaredError: 3.327,
      rSquared: 0.4213,
    },
  }
} as const;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const roundToSix = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

/**
 * Normalize source/provider positions to the REC position keys used by the model.
 */
export function normalizeRecOvrPosition(position: string): RecOvrPosition {
  const normalized = position.trim().toUpperCase();
  const mapped = REC_POSITION_ALIASES[normalized];

  if (!mapped) {
    throw new Error(`Unsupported OVR position: ${position}`);
  }

  return mapped;
}

/**
 * Estimate current player OVR from the player's current attributes.
 *
 * Exact formula:
 *   weightedSum = Σ(coefficient[attr] × clamp(attribute[attr], 0, 99))
 *   linearScore = weightedSum / Σ(coefficient[attr])
 *   rawOverall  = 99 × (clamp(linearScore / 99, 0, 1) ^ gamma)
 *   displayOVR  = floor(rawOverall + 0.5)
 *
 * Dividing by the frozen coefficient total protects the 0 and 99 anchors from
 * decimal serialization drift in the six-decimal coefficient table.
 *
 * Missing attributes are intentionally treated as zero because every editable
 * custom-player attribute begins at zero.
 *
 * Development trait is not an input and must never alter current OVR.
 */
export function estimateRecPlayerOverall(
  positionInput: string,
  attributes: RecPlayerAttributes
): RecOverallResult {
  const position = normalizeRecOvrPosition(positionInput);
  const model = REC_POSITION_OVR_MODELS[position];

  let weightedSum = 0;
  let coefficientTotal = 0;
  const missingAttributes: string[] = [];

  for (const [attributeCode, coefficient] of Object.entries(model.coefficients)) {
    coefficientTotal += coefficient;

    const suppliedValue = attributes[attributeCode];

    if (suppliedValue === undefined || suppliedValue === null) {
      missingAttributes.push(attributeCode);
    }

    const numericValue =
      typeof suppliedValue === "number" && Number.isFinite(suppliedValue)
        ? suppliedValue
        : 0;

    weightedSum += coefficient * clamp(numericValue, 0, 99);
  }

  if (!(coefficientTotal > 0)) {
    throw new Error(`OVR model for ${position} has no positive coefficients`);
  }

  const linearScore = roundToSix(weightedSum / coefficientTotal);
  const normalizedScore = clamp(linearScore / 99, 0, 1);
  const unroundedRawOverall = 99 * Math.pow(normalizedScore, model.gamma);
  const rawOverall = roundToSix(unroundedRawOverall);
  const displayOverall = clamp(Math.floor(unroundedRawOverall + 0.5), 0, 99);

  const sampleConfidence = Math.min(1, model.validation.testN / 100);
  const confidence = roundToSix(
    clamp(model.validation.rSquared, 0, 1) * sampleConfidence
  );

  return {
    rawOverall,
    displayOverall,
    linearScore,
    confidence,
    missingAttributes,
    position,
    modelVersion: REC_OVR_MODEL_VERSION,
  };
}

/**
 * Calculate the exact live OVR movement caused by one proposed attribute value.
 * The caller still must apply creation-point, package-cap, and support-gate rules.
 */
export function estimateRecPlayerOverallDelta(
  position: string,
  currentAttributes: RecPlayerAttributes,
  attributeCode: string,
  proposedValue: number
): RecOverallDeltaResult {
  const before = estimateRecPlayerOverall(position, currentAttributes);
  const after = estimateRecPlayerOverall(position, {
    ...currentAttributes,
    [attributeCode]: proposedValue,
  });

  return {
    before,
    after,
    rawDelta: roundToSix(after.rawOverall - before.rawOverall),
    displayDelta: after.displayOverall - before.displayOverall,
  };
}

/**
 * Package hard caps must use rawOverall, not displayOverall.
 */
export function exceedsRecRawOverallCap(
  result: Pick<RecOverallResult, "rawOverall">,
  rawOverallCap: number
): boolean {
  return result.rawOverall > rawOverallCap + 1e-9;
}

export interface RecOvrTestVector {
  position: RecOvrPosition;
  attributes: Record<string, number>;
  expectedRawOverall: number;
  expectedDisplayOverall: number;
}

/**
 * Deterministic mixed-attribute fixtures generated from the frozen v1 coefficients.
 * These catch coefficient, exponent, alias, and rounding drift.
 */
export const REC_OVR_TEST_VECTORS: readonly RecOvrTestVector[] = [
  {
    position: "QB",
    attributes: { acc: 72, awr: 83, bsk: 61, cod: 72, dac: 83, mac: 61, pac: 72, run: 83, sac: 61, spd: 72, thp: 83, tup: 61 },
    expectedRawOverall: 65.480663,
    expectedDisplayOverall: 65,
  },
  {
    position: "HB",
    attributes: { acc: 72, agi: 83, awr: 61, bcv: 72, btk: 83, car: 61, cod: 72, cth: 83, jkm: 61, sfa: 72, spd: 83, spm: 61, trk: 72 },
    expectedRawOverall: 68.765477,
    expectedDisplayOverall: 69,
  },
  {
    position: "FB",
    attributes: { acc: 72, awr: 83, bcv: 61, car: 72, cth: 83, ibl: 61, lbk: 72, rbk: 83, sfa: 61, spd: 72, str: 83, trk: 61 },
    expectedRawOverall: 72.714464,
    expectedDisplayOverall: 73,
  },
  {
    position: "WR",
    attributes: { acc: 72, agi: 83, awr: 61, cit: 72, cod: 83, cth: 61, drr: 72, mrr: 83, rls: 61, spc: 72, spd: 83, srr: 61 },
    expectedRawOverall: 66.636251,
    expectedDisplayOverall: 67,
  },
  {
    position: "TE",
    attributes: { acc: 72, awr: 83, cit: 61, cth: 72, drr: 83, ibl: 61, lbk: 72, mrr: 83, rbk: 61, rls: 72, spc: 83, spd: 61, srr: 72, str: 83 },
    expectedRawOverall: 71.497760,
    expectedDisplayOverall: 71,
  },
  {
    position: "LT",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 68.166776,
    expectedDisplayOverall: 68,
  },
  {
    position: "LG",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 68.042972,
    expectedDisplayOverall: 68,
  },
  {
    position: "C",
    attributes: { awr: 65, ibl: 76, lbk: 87, pbf: 65, pbk: 76, pbp: 87, rbf: 65, rbk: 76, rbp: 87, str: 65 },
    expectedRawOverall: 67.544942,
    expectedDisplayOverall: 68,
  },
  {
    position: "RG",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 67.962359,
    expectedDisplayOverall: 68,
  },
  {
    position: "RT",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 68.270853,
    expectedDisplayOverall: 68,
  },
  {
    position: "LE",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, spd: 61, str: 72, tak: 83 },
    expectedRawOverall: 70.916732,
    expectedDisplayOverall: 71,
  },
  {
    position: "RE",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, spd: 61, str: 72, tak: 83 },
    expectedRawOverall: 71.100334,
    expectedDisplayOverall: 71,
  },
  {
    position: "DT",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, str: 61, tak: 72 },
    expectedRawOverall: 67.780468,
    expectedDisplayOverall: 68,
  },
  {
    position: "LOLB",
    attributes: { acc: 86, agi: 64, awr: 75, bsh: 86, fmv: 64, mcv: 75, pmv: 86, pow: 64, prc: 75, pur: 86, spd: 64, tak: 75, zcv: 86 },
    expectedRawOverall: 73.620632,
    expectedDisplayOverall: 74,
  },
  {
    position: "MLB",
    attributes: { acc: 79, agi: 90, awr: 68, bsh: 79, cth: 90, mcv: 68, pow: 79, prc: 90, pur: 68, spd: 79, tak: 90, zcv: 68 },
    expectedRawOverall: 74.146985,
    expectedDisplayOverall: 74,
  },
  {
    position: "ROLB",
    attributes: { acc: 86, agi: 64, awr: 75, bsh: 86, fmv: 64, mcv: 75, pmv: 86, pow: 64, prc: 75, pur: 86, spd: 64, tak: 75, zcv: 86 },
    expectedRawOverall: 73.315118,
    expectedDisplayOverall: 73,
  },
  {
    position: "CB",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, prc: 72, prs: 83, pur: 61, spd: 72, tak: 83, zcv: 61 },
    expectedRawOverall: 65.800125,
    expectedDisplayOverall: 66,
  },
  {
    position: "FS",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, pow: 72, prc: 83, prs: 61, pur: 72, spd: 83, tak: 61, zcv: 72 },
    expectedRawOverall: 68.275446,
    expectedDisplayOverall: 68,
  },
  {
    position: "SS",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, pow: 72, prc: 83, prs: 61, pur: 72, spd: 83, tak: 61, zcv: 72 },
    expectedRawOverall: 67.906259,
    expectedDisplayOverall: 68,
  },
  {
    position: "K",
    attributes: { awr: 65, kac: 76, kpw: 87 },
    expectedRawOverall: 76.367625,
    expectedDisplayOverall: 76,
  },
  {
    position: "P",
    attributes: { awr: 65, kac: 76, kpw: 87 },
    expectedRawOverall: 75.820434,
    expectedDisplayOverall: 76,
  }
] as const;

/**
 * Dependency-free self-check that Claude can invoke from a script or adapt into
 * the repository's eventual test runner.
 */
export function assertRecOvrModelFixtures(): void {
  for (const fixture of REC_OVR_TEST_VECTORS) {
    const result = estimateRecPlayerOverall(
      fixture.position,
      fixture.attributes
    );

    if (Math.abs(result.rawOverall - fixture.expectedRawOverall) > 0.00001) {
      throw new Error(
        `${fixture.position} raw OVR fixture failed: expected ` +
          `${fixture.expectedRawOverall}, received ${result.rawOverall}`
      );
    }

    if (result.displayOverall !== fixture.expectedDisplayOverall) {
      throw new Error(
        `${fixture.position} display OVR fixture failed: expected ` +
          `${fixture.expectedDisplayOverall}, received ${result.displayOverall}`
      );
    }
  }

  for (const position of Object.keys(
    REC_POSITION_OVR_MODELS
  ) as RecOvrPosition[]) {
    const zero = estimateRecPlayerOverall(position, {});
    if (zero.rawOverall !== 0 || zero.displayOverall !== 0) {
      throw new Error(`${position} zero-anchor invariant failed`);
    }

    const allNinetyNine = Object.fromEntries(
      Object.keys(REC_POSITION_OVR_MODELS[position].coefficients).map(
        (attributeCode) => [attributeCode, 99]
      )
    );
    const maximum = estimateRecPlayerOverall(position, allNinetyNine);
    if (maximum.rawOverall !== 99 || maximum.displayOverall !== 99) {
      throw new Error(`${position} 99-anchor invariant failed`);
    }
  }
}
