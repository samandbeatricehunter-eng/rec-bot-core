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
