import { FORMULA_VERSIONS } from "./types.js";
import type { CharacteristicModifiers } from "./characteristics.js";

export type ContractBand = {
  min: number;
  max: number;
  tier: string;
  coinsPerSeason: number;
};

export const ROOKIE_CONTRACT_COINS: Record<string, number> = {
  top_10: 2500,
  rest_round_1: 2200,
  round_2: 1900,
  round_3: 1600,
  round_4: 1300,
  round_5: 1100,
  round_6: 900,
  round_7: 750,
};

export const PERFORMANCE_CONTRACT_BANDS: ContractBand[] = [
  { min: 90, max: 100, tier: "Immortal Market", coinsPerSeason: 3500 },
  { min: 80, max: 89.999, tier: "Superstar", coinsPerSeason: 3000 },
  { min: 70, max: 79.999, tier: "Elite", coinsPerSeason: 2500 },
  { min: 60, max: 69.999, tier: "Star", coinsPerSeason: 2100 },
  { min: 45, max: 59.999, tier: "Starter", coinsPerSeason: 1700 },
  { min: 30, max: 44.999, tier: "Prove It", coinsPerSeason: 1300 },
  { min: 0, max: 29.999, tier: "Minimum", coinsPerSeason: 1000 },
];

export const ELITE_BAND_COINS = 2500;
export const GREAT_NEGOTIATOR_MULTIPLIER = 1.2;

export function bandForScore(score: number): ContractBand {
  const clamped = Math.max(0, Math.min(100, score));
  return PERFORMANCE_CONTRACT_BANDS.find((band) => clamped >= band.min && clamped <= band.max)
    ?? PERFORMANCE_CONTRACT_BANDS[PERFORMANCE_CONTRACT_BANDS.length - 1];
}

export function rookieContractCoins(input: { overallPick: number; round: number }): { band: string; coinsPerSeason: number } {
  if (input.round <= 1 && input.overallPick <= 10) return { band: "top_10", coinsPerSeason: ROOKIE_CONTRACT_COINS.top_10 };
  if (input.round <= 1) return { band: "rest_round_1", coinsPerSeason: ROOKIE_CONTRACT_COINS.rest_round_1 };
  const key = `round_${Math.max(2, Math.min(7, input.round))}`;
  return { band: key, coinsPerSeason: ROOKIE_CONTRACT_COINS[key] ?? ROOKIE_CONTRACT_COINS.round_7 };
}

export type PerformanceContractInput = {
  productionScore: number;
  awardsScore: number;
  postseasonScore: number;
  modifiers: Pick<CharacteristicModifiers, "knownCommodityFloor" | "negotiatorMultiplier">;
};

export type PerformanceContractResult = {
  rawPerformanceScore: number;
  knownCommodityFloorApplied: boolean;
  negotiatorMultiplier: number;
  band: string;
  coinsPerSeason: number;
  formulaVersion: typeof FORMULA_VERSIONS.contracts;
};

export function scorePerformanceContract(input: PerformanceContractInput): PerformanceContractResult {
  const rawPerformanceScore = (0.7 * input.productionScore) + (0.2 * input.awardsScore) + (0.1 * input.postseasonScore);
  let working = rawPerformanceScore;
  const knownCommodityFloorApplied = input.modifiers.knownCommodityFloor && bandForScore(working).coinsPerSeason < ELITE_BAND_COINS;
  if (input.modifiers.knownCommodityFloor) {
    const current = bandForScore(working);
    if (current.coinsPerSeason < ELITE_BAND_COINS) working = 70;
  }
  const baseBand = bandForScore(working);
  const negotiatorMultiplier = input.modifiers.negotiatorMultiplier || 1;
  const coinsPerSeason = Math.round(baseBand.coinsPerSeason * negotiatorMultiplier);
  return {
    rawPerformanceScore,
    knownCommodityFloorApplied,
    negotiatorMultiplier,
    band: baseBand.tier,
    coinsPerSeason,
    formulaVersion: FORMULA_VERSIONS.contracts,
  };
}

export const RTI_CONTRACT_FORMULA_VERSION = "immortality-contracts-v2";

export const RTI_ROOKIE_CONTRACT_XP = { min: 2, max: 5 } as const;
export const RTI_ROOKIE_CONTRACT_COINS = { min: 2000, max: 5000 } as const;
export const RTI_SECOND_CONTRACT_XP = { min: 4, max: 10 } as const;
export const RTI_SECOND_CONTRACT_COINS = { min: 5000, max: 20000 } as const;
export const RTI_THIRD_CONTRACT_XP = { min: 2, max: 8 } as const;
export const RTI_THIRD_CONTRACT_COINS = { min: 4000, max: 12000 } as const;

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededInt(seed: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashSeed(seed) % span);
}

export function lerpInt(min: number, max: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(min + (max - min) * clamped);
}

/** One-time payout at signing for contract 1 (years 1–3). Deterministic per prospect. */
export function rookieContractPayout(prospectId: string): { playerXp: number; coins: number } {
  return {
    playerXp: seededInt(`${prospectId}:c1:xp`, RTI_ROOKIE_CONTRACT_XP.min, RTI_ROOKIE_CONTRACT_XP.max),
    coins: seededInt(`${prospectId}:c1:coins`, RTI_ROOKIE_CONTRACT_COINS.min, RTI_ROOKIE_CONTRACT_COINS.max),
  };
}

export function performanceContractPayout(input: {
  contractNumber: 2 | 3;
  percentile: number;
  negotiatorMultiplier: number;
  knownCommodityFloor: boolean;
}): { playerXp: number; coins: number; percentile: number } {
  let t = Math.max(0, Math.min(1, input.percentile));
  if (input.knownCommodityFloor) t = Math.max(t, 0.7);
  const xpRange = input.contractNumber === 2 ? RTI_SECOND_CONTRACT_XP : RTI_THIRD_CONTRACT_XP;
  const coinRange = input.contractNumber === 2 ? RTI_SECOND_CONTRACT_COINS : RTI_THIRD_CONTRACT_COINS;
  return {
    playerXp: lerpInt(xpRange.min, xpRange.max, t),
    coins: Math.round(lerpInt(coinRange.min, coinRange.max, t) * (input.negotiatorMultiplier || 1)),
    percentile: t,
  };
}

export function rtiContractWindow(contractNumber: 1 | 2 | 3): { startSeason: number; endSeason: number } {
  if (contractNumber === 1) return { startSeason: 1, endSeason: 3 };
  if (contractNumber === 2) return { startSeason: 4, endSeason: 7 };
  return { startSeason: 8, endSeason: 10 };
}
