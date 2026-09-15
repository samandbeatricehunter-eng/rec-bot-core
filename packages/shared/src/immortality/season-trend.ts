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
 *  - Star→SS: 6-week window scoring 12+ with two golds and a 1-gold streak to finish.
 *  - SS→XF: 8-week window scoring 16+ with three golds and a 2-gold finishing streak.
 * Star/Superstar were recalibrated from the Dev Promotion Overhaul deep-dive (2026-09-14):
 * the original 14/20-score, 2-gold-streak/3-gold-streak bars modeled out to a ~0.6%/~0.003%
 * chance of ever seeing a single opportunity across an 18-week season -- these are the deep-
 * dive's candidate replacement bands, picked at the low end of each proposed range to move
 * incidence toward the target 25-40% (Star) / 10-20% (Superstar) per-season bands. Provisional
 * until a real backtest (04_VALIDATION_AND_BACKTEST_PLAN.md) has enough seasons of data to
 * confirm or retune them. */
export const SEASON_TREND_RULES: Record<Exclude<ImmortalityDevTrait, "xfactor">, SeasonTrendRule> = {
  normal: { window: 4, minScore: 8, minGolds: 1, minConsecutiveGolds: 0 },
  star: { window: 6, minScore: 12, minGolds: 2, minConsecutiveGolds: 1 },
  superstar: { window: 8, minScore: 16, minGolds: 3, minConsecutiveGolds: 2 },
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

/** Faster Developer's advantage is check-cadence, not a shorter trend window (see the Dev
 * Promotion Overhaul deep-dive, section 13 "Option A"). Shrinking the window instead of the
 * cadence made Star/Superstar Faster Developer prospects mathematically unable to ever clear
 * the score/gold bar without an external record-break bonus, since the shrunk window couldn't
 * hold enough golds to reach the unshrunk score requirement -- the opposite of a perk. Every
 * prospect's trend window/score/gold/streak requirements are identical regardless of this
 * bonus now; Faster Developer instead gets evaluated for a promotion opportunity more often
 * (see promotionCheckCadence and evaluateSeasonTrendPromotionsAfterAdvance in
 * progression.service.ts), which can only ever help, never hurt, a prospect's odds. */
export function promotionCheckCadence(baseCadence: number, promotionCheckBonus: number): number {
  return Math.max(1, Math.round(baseCadence / (1 + Math.max(0, promotionCheckBonus))));
}

export type SeasonTrendResult =
  | { promote: true; nextDevTrait: ImmortalityDevTrait; reason: string; window: number; score: number; golds: number }
  | { promote: false; reason: string; window: number; score: number; golds: number; nextDevTrait: ImmortalityDevTrait | null };

export function evaluateSeasonTrend(input: {
  currentDevTrait: ImmortalityDevTrait;
  medals: TrendMedal[];
  /** Extra trend-score points from real, verified events outside the weekly-challenge medal
   *  system -- currently just "broke an NFL top-5 record recently" (see
   *  progression.service.ts's evaluateSeasonTrendPromotionsAfterAdvance). Only nudges the score
   *  threshold; the gold-count and consecutive-gold requirements below are untouched, so a
   *  record break alone with no real form still can't promote someone on its own -- it only
   *  helps a prospect who's already close on every other factor. */
  recordBreakBonusScore?: number;
}): SeasonTrendResult {
  const nextDevTrait = promotionPath(input.currentDevTrait);
  if (!nextDevTrait) {
    return { promote: false, reason: "Already at X-Factor.", window: 0, score: 0, golds: 0, nextDevTrait: null };
  }
  const rule = SEASON_TREND_RULES[input.currentDevTrait as Exclude<ImmortalityDevTrait, "xfactor">];
  const window = rule.window;
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
  const recordBonus = Math.max(0, input.recordBreakBonusScore ?? 0);
  const score = windowScore(slice) + recordBonus;
  const bonusNote = recordBonus > 0 ? ` (includes +${recordBonus} for a recent record break)` : "";
  const golds = slice.filter((medal) => medal === "gold").length;
  const consecutive = trailingGoldCount(slice);
  if (score < rule.minScore) {
    return {
      promote: false,
      reason: `Need ${rule.minScore} trend points over the last ${window} weeks (currently ${score}${bonusNote}).`,
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
    reason: `Last ${window} weeks scored ${score} with ${golds} gold${golds === 1 ? "" : "s"}${bonusNote}.`,
    window,
    score,
    golds,
  };
}
