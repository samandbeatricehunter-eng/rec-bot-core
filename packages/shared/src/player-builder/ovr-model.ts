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
 *
 * v3 (2026-08): every position except FB (too few real players to refit — see its coefficient
 * comment) is now recalibrated against real Madden 27 rosters (apps/api/scripts/data/madden27/
 * madden27_all_rosters.csv + madden27_free_agents.csv, ~2,565 real players with real EA ovr and
 * full attributes) using the same gradient-descent refit against real OVR (light L2
 * regularization toward the prior weighting) already used for QB/HB/WR/TE in v2. Previously only
 * those four had gotten that treatment; everyone else was still on v1/v2 weights derived from a
 * CFB 27 college-roster regression or the years-old EA chart, which is what let offensive-line
 * builds legal under REC's own (now-unenforced, see build-validator.ts v1.7.0) OVR cap come out
 * far higher once actually applied in Madden. See recalibrate-ovr-model.ts for the fitting
 * script and each position's coefficient comment for its specific before/after error.
 */

export const REC_OVR_MODEL_VERSION = "rec-ovr-madden27-positional-v3.0.0" as const;

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
  OT: "LT",
  LG: "LG",
  OG: "LG",
  C: "C",
  RG: "RG",
  RT: "RT",
  LE: "LE",
  DE: "LE",
  LEDG: "LE",
  RE: "RE",
  REDG: "RE",
  DT: "DT",
  LOLB: "LOLB",
  OLB: "LOLB",
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
  // Not recalibrated 2026-08 (unlike every other position below) — only 14 real Madden 27 FBs
  // exist across all 32 rosters + free agents, too small a sample to refit reliably (a test run
  // came back R^2 < 0, worse than the existing model). Left on the old CFB27-derived weights.
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
  // Recalibrated 2026-08 against 95 real Madden 27 LTs (baseline import + free agents) — this
  // is the position the launch-day bug report was about: builds legal under the old (CFB
  // 27-college-roster-derived) weights were coming out 92-95 in-game, well past what an 81 raw
  // OVR cap should have allowed. Refit the same way as QB/HB/WR/TE (gradient descent against
  // real OVR with light L2 regularization toward the original weighting); held-out MAE against
  // the OLD live model was 2.10, refit brings it to 1.31.
  LT: {
    gamma: 1.23,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.746629, ibl: 0.241219, lbk: 0.02, pbf: 0.524096, pbk: 0.727668, pbp: 1.369739, rbf: 0.02, rbk: 1.034422, rbp: 0.02, spd: 0.02, str: 0.02 },
    validation: {
      trainN: 76,
      testN: 19,
      meanAbsoluteError: 1.314,
      rootMeanSquaredError: 1.538,
      rSquared: 0.9758,
    },
  },
  // Recalibrated 2026-08 against 85 real Madden 27 LGs — the prior weights underrated the
  // position by a mean -1.20 (MAE 1.61) on real rosters. Refit the same way as LT; MAE now 1.01.
  LG: {
    gamma: 1.24,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.75684, ibl: 0.024841, lbk: 0.02, pbf: 0.329119, pbk: 0.071536, pbp: 1.263548, rbf: 0.544296, rbk: 0.245936, rbp: 0.444796, spd: 0.02, str: 0.492925 },
    validation: {
      trainN: 68,
      testN: 17,
      meanAbsoluteError: 1.005,
      rootMeanSquaredError: 1.340,
      rSquared: 0.9570,
    },
  },
  // Recalibrated 2026-08 against 89 real Madden 27 Cs — refit the same way as LT; MAE 1.52 -> 1.24.
  C: {
    gamma: 1.24,
    coefficients: { acc: 0.02, agi: 0.02, awr: 1.185897, ibl: 0.02, lbk: 0.02, pbf: 0.915071, pbk: 0.02, pbp: 0.411873, rbf: 0.02, rbk: 0.917196, rbp: 0.239585, spd: 0.02, str: 0.02 },
    validation: {
      trainN: 71,
      testN: 18,
      meanAbsoluteError: 1.242,
      rootMeanSquaredError: 1.391,
      rSquared: 0.9609,
    },
  },
  // Recalibrated 2026-08 against 97 real Madden 27 RGs — refit the same way as LT; MAE 1.46 -> 1.00.
  RG: {
    gamma: 1.26,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.83912, ibl: 0.279852, lbk: 0.359874, pbf: 0.02, pbk: 0.02, pbp: 0.714807, rbf: 0.237875, rbk: 0.645034, rbp: 0.740394, spd: 0.02, str: 0.250818 },
    validation: {
      trainN: 78,
      testN: 19,
      meanAbsoluteError: 1.004,
      rootMeanSquaredError: 1.379,
      rSquared: 0.9460,
    },
  },
  // Recalibrated 2026-08 against 95 real Madden 27 RTs — refit the same way as LT; MAE 1.81 -> 0.84.
  RT: {
    gamma: 1.22,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.799101, ibl: 0.02, lbk: 0.02, pbf: 0.284148, pbk: 0.524875, pbp: 0.656521, rbf: 0.405694, rbk: 0.694767, rbp: 0.641547, spd: 0.02, str: 0.113431 },
    validation: {
      trainN: 76,
      testN: 19,
      meanAbsoluteError: 0.840,
      rootMeanSquaredError: 1.157,
      rSquared: 0.9786,
    },
  },
  // Recalibrated 2026-08 against 123 real Madden 27 LEs — refit the same way as LT; MAE 2.19 -> 1.59.
  LE: {
    gamma: 1.18,
    coefficients: { acc: 0.16352, agi: 0.166471, awr: 0.5441, bsh: 0.023868, fmv: 0.156503, pmv: 0.115446, pow: 0.02, prc: 0.02, pur: 0.107935, spd: 0.02, str: 0.060315, tak: 0.35676 },
    validation: {
      trainN: 98,
      testN: 25,
      meanAbsoluteError: 1.586,
      rootMeanSquaredError: 1.946,
      rSquared: 0.9327,
    },
  },
  // Recalibrated 2026-08 against 115 real Madden 27 REs — refit the same way as LT; MAE 2.08 -> 1.30.
  RE: {
    gamma: 1.17,
    coefficients: { acc: 0.212809, agi: 0.047189, awr: 0.666345, bsh: 0.02, fmv: 0.305234, pmv: 0.126853, pow: 0.02, prc: 0.02, pur: 0.325775, spd: 0.02, str: 0.124832, tak: 0.198516 },
    validation: {
      trainN: 92,
      testN: 23,
      meanAbsoluteError: 1.300,
      rootMeanSquaredError: 1.596,
      rSquared: 0.9446,
    },
  },
  // Recalibrated 2026-08 against 266 real Madden 27 DTs — refit the same way as LT; MAE 2.00 -> 1.02.
  DT: {
    gamma: 1.36,
    coefficients: { acc: 0.162865, agi: 0.02, awr: 0.260816, bsh: 0.405071, fmv: 0.02, pmv: 0.02, pow: 0.02, prc: 0.473976, pur: 0.02, spd: 0.02, str: 0.601259, tak: 0.446434 },
    validation: {
      trainN: 213,
      testN: 53,
      meanAbsoluteError: 1.024,
      rootMeanSquaredError: 1.430,
      rSquared: 0.9549,
    },
  },
  // Recalibrated 2026-08 against 22 real Madden 27 SAM/LOLBs — smallest real sample of any
  // recalibrated position (few teams run a dedicated SAM in Madden's scheme labels), so trust
  // this one least of the defensive refits. Still a modest improvement over the old CFB27-derived
  // weights; MAE 1.07 -> 0.92.
  LOLB: {
    gamma: 1.29,
    coefficients: { acc: 0.02, agi: 0.02, awr: 0.313496, bsh: 0.237051, cth: 0.02, fmv: 0.02, mcv: 0.055841, pmv: 0.02, pow: 0.02, prc: 0.211091, pur: 0.20228, spd: 0.275783, str: 0.127213, tak: 0.550633, zcv: 0.02 },
    validation: {
      trainN: 18,
      testN: 4,
      meanAbsoluteError: 0.917,
      rootMeanSquaredError: 1.131,
      rSquared: 0.9336,
    },
  },
  // Recalibrated 2026-08 against 111 real Madden 27 MIKE/MLBs — the prior weights underrated the
  // position by a mean -2.81 (MAE 2.94). Refit the same way as LT; MAE now 1.58.
  MLB: {
    gamma: 1.36,
    coefficients: { acc: 0.068215, agi: 0.031337, awr: 0.657316, bsh: 0.02, cth: 0.02, fmv: 0.02, mcv: 0.040353, pmv: 0.02, pow: 0.02, prc: 0.345843, pur: 0.819789, spd: 0.041859, str: 0.02, tak: 0.599303, zcv: 0.10939 },
    validation: {
      trainN: 89,
      testN: 22,
      meanAbsoluteError: 1.584,
      rootMeanSquaredError: 1.914,
      rSquared: 0.9554,
    },
  },
  // Recalibrated 2026-08 against 107 real Madden 27 WILL/ROLBs — the prior weights underrated
  // the position by a mean -4.06 (MAE 4.07, worst bias of any defensive position). Refit the
  // same way as LT; MAE now 1.63.
  ROLB: {
    gamma: 1.38,
    coefficients: { acc: 0.123276, agi: 0.044367, awr: 0.34694, bsh: 0.043192, cth: 0.02, fmv: 0.02, mcv: 0.02, pmv: 0.02, pow: 0.042528, prc: 0.196279, pur: 0.503486, spd: 0.02, str: 0.02, tak: 0.512084, zcv: 0.047743 },
    validation: {
      trainN: 86,
      testN: 21,
      meanAbsoluteError: 1.630,
      rootMeanSquaredError: 2.002,
      rSquared: 0.9298,
    },
  },
  // Recalibrated 2026-08 against 281 real Madden 27 CBs — the prior weights overrated the
  // position by a mean +1.99 (MAE 2.61). Refit the same way as LT; MAE now 0.98.
  CB: {
    gamma: 1.26,
    coefficients: { acc: 0.294979, agi: 0.201798, awr: 0.496992, cod: 0.053954, cth: 0.02, jmp: 0.037742, mcv: 0.586648, prc: 0.376943, prs: 0.15195, pur: 0.02, spd: 0.352227, str: 0.02, tak: 0.02, zcv: 0.291774 },
    validation: {
      trainN: 225,
      testN: 56,
      meanAbsoluteError: 0.975,
      rootMeanSquaredError: 1.181,
      rSquared: 0.9708,
    },
  },
  // Recalibrated 2026-08 against 112 real Madden 27 FSs — refit the same way as LT; MAE 2.23 -> 1.22.
  FS: {
    gamma: 1.08,
    coefficients: { acc: 0.149463, agi: 0.14172, awr: 1.051739, cod: 0.02, cth: 0.02, jmp: 0.040838, mcv: 0.037566, pow: 0.02, prc: 0.172803, prs: 0.02, pur: 0.093023, spd: 0.02, str: 0.02, tak: 0.275175, zcv: 0.567853 },
    validation: {
      trainN: 90,
      testN: 22,
      meanAbsoluteError: 1.223,
      rootMeanSquaredError: 1.372,
      rSquared: 0.9671,
    },
  },
  // Recalibrated 2026-08 against 109 real Madden 27 SSs — refit the same way as LT; MAE 2.12 -> 1.54.
  SS: {
    gamma: 1.15,
    coefficients: { acc: 0.196841, agi: 0.092684, awr: 0.951073, cod: 0.02, cth: 0.02, jmp: 0.238211, mcv: 0.13457, pow: 0.02, prc: 0.503011, prs: 0.02, pur: 0.453574, spd: 0.02, str: 0.02, tak: 0.071893, zcv: 0.048039 },
    validation: {
      trainN: 87,
      testN: 22,
      meanAbsoluteError: 1.540,
      rootMeanSquaredError: 1.841,
      rSquared: 0.9435,
    },
  },
  // Recalibrated 2026-08 against 44 real Madden 27 Ks — the prior weights (never fit against
  // real kicker OVR, R^2 0.47) were little better than guessing. Refit the same way as LT;
  // MAE 1.06 -> 0.45, R^2 0.99.
  K: {
    gamma: 1.19,
    coefficients: { awr: 0.298237, kac: 0.225068, kpw: 0.282735 },
    validation: {
      trainN: 35,
      testN: 9,
      meanAbsoluteError: 0.451,
      rootMeanSquaredError: 0.687,
      rSquared: 0.9858,
    },
  },
  // Recalibrated 2026-08 against 39 real Madden 27 Ps — same story as K (prior R^2 0.42). Refit
  // the same way as LT; MAE 1.73 -> 0.32, R^2 0.98.
  P: {
    gamma: 1.15,
    coefficients: { awr: 0.313113, kac: 0.161137, kpw: 0.336593 },
    validation: {
      trainN: 31,
      testN: 8,
      meanAbsoluteError: 0.323,
      rootMeanSquaredError: 0.373,
      rSquared: 0.9840,
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
    expectedRawOverall: 67.443222,
    expectedDisplayOverall: 67,
  },
  {
    position: "LG",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 61.459396,
    expectedDisplayOverall: 61,
  },
  {
    position: "C",
    attributes: { awr: 65, ibl: 76, lbk: 87, pbf: 65, pbk: 76, pbp: 87, rbf: 65, rbk: 76, rbp: 87, str: 65 },
    expectedRawOverall: 65.084331,
    expectedDisplayOverall: 65,
  },
  {
    position: "RG",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 62.436094,
    expectedDisplayOverall: 62,
  },
  {
    position: "RT",
    attributes: { awr: 72, ibl: 83, lbk: 61, pbf: 72, pbk: 83, pbp: 61, rbf: 72, rbk: 83, rbp: 61, str: 72 },
    expectedRawOverall: 65.734067,
    expectedDisplayOverall: 66,
  },
  {
    position: "LE",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, spd: 61, str: 72, tak: 83 },
    expectedRawOverall: 67.784617,
    expectedDisplayOverall: 68,
  },
  {
    position: "RE",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, spd: 61, str: 72, tak: 83 },
    expectedRawOverall: 73.77797,
    expectedDisplayOverall: 74,
  },
  {
    position: "DT",
    attributes: { acc: 72, awr: 83, bsh: 61, fmv: 72, pmv: 83, pow: 61, prc: 72, pur: 83, str: 61, tak: 72 },
    expectedRawOverall: 58.929311,
    expectedDisplayOverall: 59,
  },
  {
    position: "LOLB",
    attributes: { acc: 86, agi: 64, awr: 75, bsh: 86, fmv: 64, mcv: 75, pmv: 86, pow: 64, prc: 75, pur: 86, spd: 64, tak: 75, zcv: 86 },
    expectedRawOverall: 64.03799,
    expectedDisplayOverall: 64,
  },
  {
    position: "MLB",
    attributes: { acc: 79, agi: 90, awr: 68, bsh: 79, cth: 90, mcv: 68, pow: 79, prc: 90, pur: 68, spd: 79, tak: 90, zcv: 68 },
    expectedRawOverall: 67.718572,
    expectedDisplayOverall: 68,
  },
  {
    position: "ROLB",
    attributes: { acc: 86, agi: 64, awr: 75, bsh: 86, fmv: 64, mcv: 75, pmv: 86, pow: 64, prc: 75, pur: 86, spd: 64, tak: 75, zcv: 86 },
    expectedRawOverall: 69.834138,
    expectedDisplayOverall: 70,
  },
  {
    position: "CB",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, prc: 72, prs: 83, pur: 61, spd: 72, tak: 83, zcv: 61 },
    expectedRawOverall: 60.318316,
    expectedDisplayOverall: 60,
  },
  {
    position: "FS",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, pow: 72, prc: 83, prs: 61, pur: 72, spd: 83, tak: 61, zcv: 72 },
    expectedRawOverall: 63.968934,
    expectedDisplayOverall: 64,
  },
  {
    position: "SS",
    attributes: { acc: 72, agi: 83, awr: 61, cod: 72, cth: 83, mcv: 61, pow: 72, prc: 83, prs: 61, pur: 72, spd: 83, tak: 61, zcv: 72 },
    expectedRawOverall: 59.152498,
    expectedDisplayOverall: 59,
  },
  {
    position: "K",
    attributes: { awr: 65, kac: 76, kpw: 87 },
    expectedRawOverall: 72.037209,
    expectedDisplayOverall: 72,
  },
  {
    position: "P",
    attributes: { awr: 65, kac: 76, kpw: 87 },
    expectedRawOverall: 73.397157,
    expectedDisplayOverall: 73,
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
