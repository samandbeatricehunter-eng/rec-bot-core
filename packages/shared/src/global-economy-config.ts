import { REC_END_SEASON_PAYOUTS, type RecEndSeasonPayoutDefinition } from "./economy.js";

export type RecGlobalEconomyConfig = {
  version: number;
  store: {
    ageReset: number;
    legend: number;
    immortal: number;
    bust: number;
    hometownHero: number;
    celebsCouldveBeens: number;
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
    highlight: number;
    highlightSeasonAward: number;
    gameOfYear: number;
    highlightWeeklyPaidLimit: number;
    highlightWeeklyUploadLimit: number;
    stream: number;
    article: number;
    /** Legacy free-text interview payout -- retired for non-RTI leagues (replaced by
     *  mediaDay below) but left configurable since RTI leagues still expose it. */
    interview: number;
    /** Weekly Media Day interview payout, paid once a team completes all 3 weekly questions.
     *  Non-RTI leagues' primary weekly interview action; RTI has its own separate constant. */
    mediaDay: number;
    gotwCorrectVote: number;
    gotwSeasonTopGuesserBonus: number;
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
    bust: 2000,
    hometownHero: 4000,
    celebsCouldveBeens: 4000,
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
    // Rebalanced 2026-09-08 so a typical Madden regular season (18 weeks, ~.500 record,
    // realistic-not-perfect participation) nets roughly 16,000 coins, and a full, highly
    // engaged season through a deep playoff run nets roughly 32,000 -- see the postseason
    // result multiplier (packages/shared/src/league-stage.ts's postseasonResultMultiplier)
    // for the playoff/championship bonus layered on top of boxScoreWin/boxScoreLoss below.
    boxScoreWin: 400,
    boxScoreLoss: 200,
    highlight: 50,
    highlightSeasonAward: 2000,
    gameOfYear: 5000,
    highlightWeeklyPaidLimit: 2,
    highlightWeeklyUploadLimit: 2,
    stream: 100,
    article: 250,
    interview: 50,
    mediaDay: 300,
    gotwCorrectVote: 75,
    gotwSeasonTopGuesserBonus: 2500,
  },
  wagers: { houseWeeklyMaximum: 1000, peerWeeklyMaximum: 5000 },
  awards: { bestPassing: 1000, bestRushing: 1000, bestDefense: 1000, mvp: 5000, mostSkilled: 2000, mostHeart: 2500 },
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

function mergeEos(
  defaults: RecEndSeasonPayoutDefinition[],
  patch: RecEndSeasonPayoutDefinition[],
): RecEndSeasonPayoutDefinition[] {
  const byKey = new Map(defaults.map((definition) => [definition.key, definition]));
  for (const item of patch) {
    if (!item?.key) continue;
    const current = byKey.get(item.key);
    byKey.set(item.key, current ? { ...current, ...item } : item);
  }
  const order = [...defaults.map((definition) => definition.key), ...patch.map((item) => item.key)];
  return [...new Set(order)].map((key) => byKey.get(key)!).filter(Boolean);
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
    eos: Array.isArray(patch.eos) && patch.eos.length ? mergeEos(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.eos, patch.eos) : DEFAULT_REC_GLOBAL_ECONOMY_CONFIG.eos,
  };
}
