import type { ImmortalityDevTrait } from "./types.js";
import { promotionPath } from "./xp.js";

/** Highest weekly-challenge medal completed in a finished gameplay week. Independent of
 * career-tier challenges -- this is a rolling season form check, not a lifetime milestone. */
export type TrendMedal = "none" | "bronze" | "silver" | "gold";

export const TREND_MEDAL_SCORE: Record<TrendMedal, number> = {
  none: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

export type SeasonTrendRule = {
  window: number;
  minScore: number;
  minGolds: number;
  minConsecutiveGolds: number;
};

/** Calibrated against weekly medals (gold=3 / silver=2 / bronze=1) over the last N finished
 * gameplay weeks of this season. Gold is the hard weekly tier, so these are "hot streak"
 * bars, not participation trophies.
 *  - Normal→Star: 4-week window scoring 8+ (avg silver) with at least one gold.
 *  - Star→SS: 6-week window scoring 14+ with two golds and a 2-gold streak to finish.
 *  - SS→XF: 8-week window scoring 20+ with four golds and a 3-gold finishing streak. */
export const SEASON_TREND_RULES: Record<Exclude<ImmortalityDevTrait, "xfactor">, SeasonTrendRule> = {
  normal: { window: 4, minScore: 8, minGolds: 1, minConsecutiveGolds: 0 },
  star: { window: 6, minScore: 14, minGolds: 2, minConsecutiveGolds: 2 },
  superstar: { window: 8, minScore: 20, minGolds: 4, minConsecutiveGolds: 3 },
};

export function highestMedalForWeek(completedTiers: Array<"bronze" | "silver" | "gold">): TrendMedal {
  if (completedTiers.includes("gold")) return "gold";
  if (completedTiers.includes("silver")) return "silver";
  if (completedTiers.includes("bronze")) return "bronze";
  return "none";
}

export function trailingGoldCount(medals: TrendMedal[]): number {
  let count = 0;
  for (let index = medals.length - 1; index >= 0; index -= 1) {
    if (medals[index] !== "gold") break;
    count += 1;
  }
  return count;
}

export function windowScore(medals: TrendMedal[]): number {
  return medals.reduce((sum, medal) => sum + TREND_MEDAL_SCORE[medal], 0);
}

/** Faster Developer's promotionCheckBonus shortens the lookback (50% more often ≈ 2/3 window). */
export function effectiveTrendWindow(baseWindow: number, promotionCheckBonus: number): number {
  return Math.max(3, Math.ceil(baseWindow / (1 + Math.max(0, promotionCheckBonus))));
}

export type SeasonTrendResult =
  | { promote: true; nextDevTrait: ImmortalityDevTrait; reason: string; window: number; score: number; golds: number }
  | { promote: false; reason: string; window: number; score: number; golds: number; nextDevTrait: ImmortalityDevTrait | null };

export function evaluateSeasonTrend(input: {
  currentDevTrait: ImmortalityDevTrait;
  medals: TrendMedal[];
  promotionCheckBonus?: number;
}): SeasonTrendResult {
  const nextDevTrait = promotionPath(input.currentDevTrait);
  if (!nextDevTrait) {
    return { promote: false, reason: "Already at X-Factor.", window: 0, score: 0, golds: 0, nextDevTrait: null };
  }
  const rule = SEASON_TREND_RULES[input.currentDevTrait as Exclude<ImmortalityDevTrait, "xfactor">];
  const window = effectiveTrendWindow(rule.window, input.promotionCheckBonus ?? 0);
  if (input.medals.length < window) {
    return {
      promote: false,
      reason: `Need ${window} finished gameplay weeks this season (${input.medals.length} so far).`,
      window,
      score: 0,
      golds: 0,
      nextDevTrait,
    };
  }
  const slice = input.medals.slice(-window);
  const score = windowScore(slice);
  const golds = slice.filter((medal) => medal === "gold").length;
  const consecutive = trailingGoldCount(slice);
  if (score < rule.minScore) {
    return {
      promote: false,
      reason: `Need ${rule.minScore} trend points over the last ${window} weeks (currently ${score}).`,
      window,
      score,
      golds,
      nextDevTrait,
    };
  }
  if (golds < rule.minGolds) {
    return {
      promote: false,
      reason: `Need ${rule.minGolds} gold week${rule.minGolds === 1 ? "" : "s"} in the last ${window} (currently ${golds}).`,
      window,
      score,
      golds,
      nextDevTrait,
    };
  }
  if (consecutive < rule.minConsecutiveGolds) {
    return {
      promote: false,
      reason: `Need ${rule.minConsecutiveGolds} consecutive gold weeks to finish the window (currently ${consecutive}).`,
      window,
      score,
      golds,
      nextDevTrait,
    };
  }
  return {
    promote: true,
    nextDevTrait,
    reason: `Last ${window} weeks scored ${score} with ${golds} gold${golds === 1 ? "" : "s"}.`,
    window,
    score,
    golds,
  };
}
