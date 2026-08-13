import { REC_END_SEASON_PAYOUTS, type RecEndSeasonPayoutDefinition } from "./economy.js";

export type RecGlobalEconomyConfig = {
  version: number;
  store: {
    ageReset: number;
    legend: number;
    immortal: number;
    devUpgradeStep: number;
    devUpgradeTopStep: number;
    contractReduction: number;
    contractExtension: number;
    coreAttributePoint: number;
    nonCoreAttributePoint: number;
    customPlayerTier1: number;
    customPlayerTier2: number;
    customPlayerTier3: number;
    customPlayerTier4: number;
    customPlayerTier5: number;
  };
  submissions: {
    boxScoreWin: number;
    boxScoreLoss: number;
    badgeBonus: number;
    highlight: number;
    highlightSeasonAward: number;
    gameOfYear: number;
    highlightWeeklyPaidLimit: number;
    highlightWeeklyUploadLimit: number;
    stream: number;
    article: number;
    interview: number;
    gotwCorrectVote: number;
    potw: number;
  };
  wagers: { houseWeeklyMaximum: number; peerWeeklyMaximum: number };
  awards: {
    bestPassing: number;
    bestRushing: number;
    bestDefense: number;
    mvp: number;
    mostSkilled: number;
    mostHeart: number;
  };
  eos: RecEndSeasonPayoutDefinition[];
};

export const DEFAULT_REC_GLOBAL_ECONOMY_CONFIG: RecGlobalEconomyConfig = {
  version: 1,
  store: {
    ageReset: 1000,
    legend: 4000,
    immortal: 8000,
    devUpgradeStep: 500,
    devUpgradeTopStep: 1500,
    contractReduction: 500,
    contractExtension: 500,
    coreAttributePoint: 200,
    nonCoreAttributePoint: 100,
    customPlayerTier1: 500,
    customPlayerTier2: 750,
    customPlayerTier3: 1000,
    customPlayerTier4: 1500,
    customPlayerTier5: 2000,
  },
  submissions: {
    boxScoreWin: 100,
    boxScoreLoss: 50,
    badgeBonus: 10,
    highlight: 25,
    highlightSeasonAward: 500,
    gameOfYear: 250,
    highlightWeeklyPaidLimit: 2,
    highlightWeeklyUploadLimit: 2,
    stream: 50,
    article: 100,
    interview: 50,
    gotwCorrectVote: 25,
    potw: 10,
  },
  wagers: { houseWeeklyMaximum: 1000, peerWeeklyMaximum: 5000 },
  awards: { bestPassing: 200, bestRushing: 200, bestDefense: 200, mvp: 1000, mostSkilled: 350, mostHeart: 500 },
  eos: REC_END_SEASON_PAYOUTS,
};

// Only known fields survive a merge — a stored config from before a field was retired (e.g.
// the legacy custom-player bronze/silver/gold prices, weekly challenges) must not resurrect it
// in the admin UI just because the old JSON blob still has the key.
function mergeSection<T extends Record<string, number>>(defaults: T, patch: unknown): T {
  if (!patch || typeof patch !== "object") return { ...defaults };
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = (patch as Record<string, unknown>)[key as string];
    if (typeof value === "number") result[key] = value as T[keyof T];
  }
  return result;
}

export function mergeGlobalEconomyConfig(value: unknown): RecGlobalEconomyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG);
  const patch = value as Partial<RecGlobalEconomyConfig>;
  return {
    version: patch.version ?? DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.version,
    store: mergeSection(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.store, patch.store),
    submissions: mergeSection(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.submissions, patch.submissions),
    wagers: mergeSection(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.wagers, patch.wagers),
    awards: mergeSection(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.awards, patch.awards),
    eos: Array.isArray(patch.eos) && patch.eos.length ? patch.eos : DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.eos,
  };
}
