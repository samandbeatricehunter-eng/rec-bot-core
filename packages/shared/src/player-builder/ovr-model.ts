/**
 * REC Custom Player estimated OVR model.
 *
 * Model version: rec-ovr-cfb27-positional-v2.0.0
 * Calibration source (v1): active CFB 27 baseline roster (11,728 players), fit via
 * per-position linear regression (Lasso), the same general method documented in
 * Randal Olson's "Machine Learning Madden NFL" reverse-engineering writeup.
 * Calibration source (v2, current): real EA attribute-weight percentages per position
 * (FiveThirtyEight/Neil Paine chart, sourced from EA Sports) applied directly wherever
 * REC has a matching attribute code. Chart categories REC splits into finer sub-attributes
 * (Pass/Run Block -> base+Power+Finesse, Route Running -> Short/Medium/Deep) keep v1's
 * internal ratio among those sub-codes, rescaled to the chart's real total. Attributes with
 * no chart analog (TUP, BSK, and similar newer/omitted attributes) retain their v1
 * regression-derived weight unchanged — the two calibration sources are mixed within the
 * same normalized coefficient set, which is safe since estimateRecPlayerOverall always
 * divides by the coefficient total regardless of where each weight came from.
 *
 * This is an empirical REC estimator, not EA's undisclosed proprietary in-game OVR
 * formula — the chart itself is several Madden years old and EA's real weights have surely
 * shifted since, but it's real EA-sourced data rather than a regression approximation, so
 * every attribute it covers now uses the real weight instead of the fitted one.
 * CFB 27 and Madden 26/27 may share this version initially, but each game/year must
 * reference its own versioned configuration record so later recalibration is safe.
 */

export const REC_OVR_MODEL_VERSION = "rec-ovr-cfb27-positional-v2.1.0" as const;

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
  // Recalibrated 2026-08 against 128 real Madden 27 QBs (baseline import) — the prior
  // EA-chart-derived weights overrated the position by a mean +3.6 (MAE 4.70). Refit via
  // gradient descent against real OVR with light L2 regularization toward the original
  // weighting (so no attribute collapses to irrelevance) — mean error now -0.37 (MAE 2.04).
  QB: {
    gamma: 1.77,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.231814, bsk: 0.040963, cod: 0.02, dac: 0.093571, mac: 0.371408, pac: 0.038535, run: 0.19789, sac: 0.441728, spd: 0.02, thp: 0.432296, tup: 0.02 },
    validation: {
      trainN: 128,
      testN: 128,
      meanAbsoluteError: 2.04,
      rootMeanSquaredError: 2.612,
      rSquared: 0.9325,
    },
  },
  // Recalibrated 2026-08 against 168 real Madden 27 HBs — the prior weights overrated the
  // position by a mean +6.2 (MAE 6.77, worst of any position — backups read 12-14 points high).
  // Refit the same way as QB; mean error now -0.33 (MAE 2.01).
  HB: {
    gamma: 1.47,
    coefficients: { acc: 0.02, agi: 0.15591, awr: 0.421215, bcv: 0.399025, btk: 0.27944, car: 0.193334, cod: 0.03746, cth: 0.02, jkm: 0.34449, sfa: 0.02, spd: 0.132966, spm: 0.02, str: 0.02, trk: 0.02 },
    validation: {
      trainN: 168,
      testN: 168,
      meanAbsoluteError: 2.01,
      rootMeanSquaredError: 2.546,
      rSquared: 0.8868,
    },
  },
  FB: {
    gamma: 0.99,
    coefficients: { acc: 0.06, agi: 0.03, awr: 0.18, bcv: 0.03, car: 0.09, cth: 0.03, ibl: 0.12, lbk: 0.106928, pbf: 0.03, pbk: 0.03, pbp: 0.03, rbk: 0.18, sfa: 0.03, spd: 0.06, str: 0.03, trk: 0.06 },
    validation: {
      trainN: 20,
      testN: 3,
      meanAbsoluteError: 3.189,
      rootMeanSquaredError: 3.271,
      rSquared: 0.7781,
    },
  },
  // Recalibrated 2026-08 against 341 real Madden 27 WRs — the prior weights overrated the
  // position by a mean +4.1 (MAE 4.55). Refit the same way as QB; mean error now -0.21
  // (MAE 1.30).
  WR: {
    gamma: 1.29,
    coefficients: { acc: 0.035277, agi: 0.162746, awr: 0.414388, bcv: 0.194274, car: 0.02, cit: 0.059865, cod: 0.19219, cth: 0.299576, drr: 0.304503, jkm: 0.042661, jmp: 0.025929, mrr: 0.327544, rls: 0.17989, sfa: 0.02, spc: 0.121298, spd: 0.159576, spm: 0.02, srr: 0.192859, str: 0.02, trk: 0.02 },
    validation: {
      trainN: 341,
      testN: 341,
      meanAbsoluteError: 1.30,
      rootMeanSquaredError: 1.705,
      rSquared: 0.9439,
    },
  },
  // Recalibrated 2026-08 against 194 real Madden 27 TEs — the prior weights had a near-zero
  // mean bias (+0.32) that hid a real problem: elite TEs (McBride, Kittle, Kelce) were
  // underrated by 12-18 points at the top while backups ran high, netting out near zero.
  // Refit the same way as QB, which also steepened gamma to fix the top-end compression;
  // mean error now -0.21 (MAE 1.90).
  TE: {
    gamma: 1.15,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.757776, bcv: 0.203207, car: 0.02, cit: 0.139431, cth: 0.643301, drr: 0.02, ibl: 0.02, jkm: 0.02, jmp: 0.070361, lbk: 0.02, mrr: 0.043524, pbf: 0.02, pbk: 0.02, pbp: 0.02, rbk: 0.02, rls: 0.02, sfa: 0.056304, spc: 0.106615, spd: 0.02, spm: 0.02, srr: 0.269211, str: 0.02, trk: 0.02 },
    validation: {
      trainN: 194,
      testN: 194,
      meanAbsoluteError: 1.90,
      rootMeanSquaredError: 2.432,
      rSquared: 0.9037,
    },
  },
  LT: {
    gamma: 1.23,
    coefficients: { acc: 0.03, agi: 0.03, awr: 0.17, ibl: 0.06, lbk: 0.029672, pbf: 0.114545, pbk: 0.153694, pbp: 0.121761, rbf: 0.051619, rbk: 0.082864, rbp: 0.055516, spd: 0.03, str: 0.11 },
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
    coefficients: { acc: 0.06, agi: 0.06, awr: 0.18, ibl: 0.09, lbk: 0.0198, pbf: 0.080088, pbk: 0.119736, pbp: 0.090176, rbf: 0.050013, rbk: 0.075943, rbp: 0.054044, spd: 0.03, str: 0.12 },
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
    coefficients: { acc: 0.03, agi: 0.03, awr: 0.2, ibl: 0.07, lbk: 0.019103, pbf: 0.074345, pbk: 0.118363, pbp: 0.077292, rbf: 0.074193, rbk: 0.120752, rbp: 0.075055, spd: 0.03, str: 0.1 },
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
    coefficients: { acc: 0.06, agi: 0.06, awr: 0.18, ibl: 0.09, lbk: 0.019763, pbf: 0.076798, pbk: 0.119897, pbp: 0.093305, rbf: 0.047486, rbk: 0.076554, rbp: 0.05596, spd: 0.03, str: 0.12 },
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
    coefficients: { acc: 0.03, agi: 0.03, awr: 0.2, ibl: 0.07, lbk: 0.030262, pbf: 0.051586, pbk: 0.080048, pbp: 0.068366, rbf: 0.089691, rbk: 0.146413, rbp: 0.093895, spd: 0.03, str: 0.1 },
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
    coefficients: { acc: 0.1, agi: 0.05, awr: 0.14, bsh: 0.1, fmv: 0.12, pmv: 0.12, pow: 0.01, prc: 0.07, pur: 0.05, spd: 0.1, str: 0.05, tak: 0.1 },
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
    coefficients: { acc: 0.1, agi: 0.05, awr: 0.14, bsh: 0.1, fmv: 0.12, pmv: 0.12, pow: 0.01, prc: 0.07, pur: 0.05, spd: 0.1, str: 0.05, tak: 0.1 },
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
    coefficients: { acc: 0.06, agi: 0.03, awr: 0.17, bsh: 0.11, fmv: 0.11, pmv: 0.11, pow: 0.083187, prc: 0.06, pur: 0.03, spd: 0.06, str: 0.17, tak: 0.09 },
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
    coefficients: { acc: 0.05, agi: 0.03, awr: 0.16, bsh: 0.08, cth: 0.02, fmv: 0.08, mcv: 0.04, pmv: 0.08, pow: 0.03, prc: 0.1, pur: 0.05, spd: 0.08, str: 0.05, tak: 0.1, zcv: 0.05 },
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
    coefficients: { acc: 0.04, agi: 0.04, awr: 0.13, bsh: 0.13, cth: 0.038154, fmv: 0.03, mcv: 0.02, pmv: 0.03, pow: 0.04, prc: 0.13, pur: 0.09, spd: 0.06, str: 0.04, tak: 0.17, zcv: 0.03 },
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
    coefficients: { acc: 0.05, agi: 0.03, awr: 0.16, bsh: 0.08, cth: 0.02, fmv: 0.08, mcv: 0.04, pmv: 0.08, pow: 0.03, prc: 0.1, pur: 0.05, spd: 0.08, str: 0.05, tak: 0.1, zcv: 0.05 },
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
    coefficients: { acc: 0.14, agi: 0.05, awr: 0.14, cod: 0.053554, cth: 0.03, jmp: 0.05, mcv: 0.19, prc: 0.09, prs: 0.05, pur: 0.039975, spd: 0.14, str: 0.02, tak: 0.05, zcv: 0.09 },
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
    coefficients: { acc: 0.05, agi: 0.05, awr: 0.16, cod: 0.032869, cth: 0.02, jmp: 0.05, mcv: 0.05, pow: 0.03, prc: 0.11, prs: 0.050105, pur: 0.082163, spd: 0.11, str: 0.03, tak: 0.11, zcv: 0.16 },
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
    coefficients: { acc: 0.03, agi: 0.03, awr: 0.18, cod: 0.030016, cth: 0.03, jmp: 0.03, mcv: 0.06, pow: 0.06, prc: 0.12, prs: 0.049654, pur: 0.095303, spd: 0.09, str: 0.06, tak: 0.12, zcv: 0.12 },
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
    coefficients: { awr: 0.27, kac: 0.45, kpw: 0.27 },
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
    coefficients: { awr: 0.3, kac: 0.4, kpw: 0.3 },
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
 * Deterministic mixed-attribute fixtures generated from the frozen v2 coefficients
 * (same attribute inputs as v1; expected outputs recomputed for the v2 recalibration).
 * These catch coefficient, exponent, alias, and rounding drift.
 */
export const REC_OVR_TEST_VECTORS: readonly RecOvrTestVector[] = [
  {
    position: "QB",
    attributes: { acc: 72, awr: 83, bsk: 61, cod: 72, dac: 83, mac: 61, pac: 72, run: 83, sac: 61, spd: 72, thp: 83, tup: 61 },
    expectedRawOverall: 55.95688,
    expectedDisplayOverall: 56,
  },
  {
    position: "HB",
    attributes: { acc: 72, agi: 83, awr: 61, bcv: 72, btk: 83, car: 61, cod: 72, cth: 83, jkm: 61, sfa: 72, spd: 83, spm: 61, trk: 72 },
    expectedRawOverall: 58.537723,
    expectedDisplayOverall: 59,
  },
  {
    position: "FB",
    attributes: { acc: 72, awr: 83, bcv: 61, car: 72, cth: 83, ibl: 61, lbk: 72, rbk: 83, sfa: 61, spd: 72, str: 83, trk: 61 },
    expectedRawOverall: 66.197075,
    expectedDisplayOverall: 66,
  },
  {
    position: "WR",
    attributes: { acc: 72, agi: 83, awr: 61, cit: 72, cod: 83, cth: 61, drr: 72, mrr: 83, rls: 61, spc: 72, spd: 83, srr: 61 },
    expectedRawOverall: 53.854807,
    expectedDisplayOverall: 54,
  },
  {
    position: "TE",
    attributes: { acc: 72, awr: 83, cit: 61, cth: 72, drr: 83, ibl: 61, lbk: 72, mrr: 83, rbk: 61, rls: 72, spc: 83, spd: 61, srr: 72, str: 83 },
    expectedRawOverall: 57.410946,
    expectedDisplayOverall: 57,
  },
  {
    position: "LT",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 60.925846,
    expectedDisplayOverall: 61,
  },
  {
    position: "LG",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 56.058944,
    expectedDisplayOverall: 56,
  },
  {
    position: "C",
    attributes: { awr: 65, ibl: 76, lbk: 87, pbf: 65, pbk: 76, pbp: 87, rbf: 65, rbk: 76, rbp: 87, str: 65 },
    expectedRawOverall: 58.783403,
    expectedDisplayOverall: 59,
  },
  {
    position: "RG",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 56.0081,
    expectedDisplayOverall: 56,
  },
  {
    position: "RT",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 60.986453,
    expectedDisplayOverall: 61,
  },
  {
    position: "LE",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, spd: 61, str: 72, tak: 83 },
    expectedRawOverall: 67.807937,
    expectedDisplayOverall: 68,
  },
  {
    position: "RE",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, spd: 61, str: 72, tak: 83 },
    expectedRawOverall: 68.037443,
    expectedDisplayOverall: 68,
  },
  {
    position: "DT",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, str: 61, tak: 72 },
    expectedRawOverall: 61.540474,
    expectedDisplayOverall: 62,
  },
  {
    position: "LOLB",
    attributes: { acc: 86, agi: 64, awr: 75, bsh: 86, fmv: 64, mcv: 75, pmv: 86, pow: 64, prc: 75, pur: 86, spd: 64, tak: 75, zcv: 86 },
    expectedRawOverall: 66.811332,
    expectedDisplayOverall: 67,
  },
  {
    position: "MLB",
    attributes: { acc: 79, agi: 90, awr: 68, bsh: 79, cth: 90, mcv: 68, pow: 79, prc: 90, pur: 68, spd: 79, tak: 90, zcv: 68 },
    expectedRawOverall: 65.923828,
    expectedDisplayOverall: 66,
  },
  {
    position: "ROLB",
    attributes: { acc: 86, agi: 64, awr: 75, bsh: 86, fmv: 64, mcv: 75, pmv: 86, pow: 64, prc: 75, pur: 86, spd: 64, tak: 75, zcv: 86 },
    expectedRawOverall: 66.363721,
    expectedDisplayOverall: 66,
  },
  {
    position: "CB",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, prc: 72, prs: 83, pur: 61, spd: 72, tak: 83, zcv: 61 },
    expectedRawOverall: 60.591427,
    expectedDisplayOverall: 61,
  },
  {
    position: "FS",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, pow: 72, prc: 83, prs: 61, pur: 72, spd: 83, tak: 61, zcv: 72 },
    expectedRawOverall: 62.288685,
    expectedDisplayOverall: 62,
  },
  {
    position: "SS",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, pow: 72, prc: 83, prs: 61, pur: 72, spd: 83, tak: 61, zcv: 72 },
    expectedRawOverall: 61.267917,
    expectedDisplayOverall: 61,
  },
  {
    position: "K",
    attributes: { awr: 65, kac: 76, kpw: 87 },
    expectedRawOverall: 71.516232,
    expectedDisplayOverall: 72,
  },
  {
    position: "P",
    attributes: { awr: 65, kac: 76, kpw: 87 },
    expectedRawOverall: 70.951238,
    expectedDisplayOverall: 71,
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
