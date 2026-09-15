import { immortalityMilestones } from "./config.js";
import {
  RECORD_SET_BONUS_POINTS,
  WEEKLY_CHALLENGE_POINTS,
  SEASON_MILESTONE_POINTS,
  CAREER_MILESTONE_POINTS,
  applyXpEarnBonus,
} from "./xp.js";
import type { CharacteristicModifiers } from "./characteristics.js";
import type { ImmortalityPosition } from "./types.js";

export type ChallengeTier = "bronze" | "silver" | "gold";
export type ChallengeScope = "weekly" | "season" | "career";

/** Whitelisted stat keys a structured condition may reference. The first block is raw stats as
 * they arrive from Madden/box-score import (see rec_player_weekly_stats.stats); the second block
 * is derived once per grading pass by derivedChallengeStats() below. Anything outside this set
 * fails closed in evaluateChallengeCondition rather than silently passing -- see that function's
 * doc comment for why this replaced the old regex parser's `return true` fallthrough. Deliberately
 * excludes tackles_for_loss: Madden never populates it (confirmed against live rec_player_weekly_stats
 * data), so any condition that somehow referenced it would be permanently uncompletable anyway --
 * excluding it here means that mistake fails closed instead of just failing forever.
 */
export type StatKey =
  | "pass_yards" | "pass_tds" | "pass_attempts" | "pass_completions" | "completion_pct" | "passer_rating"
  | "rush_yards" | "rush_tds" | "rush_attempts" | "rush_20_plus"
  | "receiving_yards" | "receiving_tds" | "receptions"
  | "tackles" | "sacks" | "forced_fumbles" | "fumble_recoveries" | "interceptions" | "interceptions_thrown"
  | "pass_deflections" | "defensive_tds" | "rushing_fumbles"
  | "total_tds" | "takeaways" | "turnovers" | "scrimmage_yards" | "ypc" | "ypr"
  | "sacks_plus_interceptions" | "forced_fumbles_plus_sacks";

export const SUPPORTED_CHALLENGE_STATS: ReadonlySet<StatKey> = new Set<StatKey>([
  "pass_yards", "pass_tds", "pass_attempts", "pass_completions", "completion_pct", "passer_rating",
  "rush_yards", "rush_tds", "rush_attempts", "rush_20_plus",
  "receiving_yards", "receiving_tds", "receptions",
  "tackles", "sacks", "forced_fumbles", "fumble_recoveries", "interceptions", "interceptions_thrown",
  "pass_deflections", "defensive_tds", "rushing_fumbles",
  "total_tds", "takeaways", "turnovers", "scrimmage_yards", "ypc", "ypr",
  "sacks_plus_interceptions", "forced_fumbles_plus_sacks",
]);

export type StatCondition = { stat: StatKey; op: "gte" | "lte"; value: number };
export type ChallengeCondition = StatCondition | { all: ChallengeCondition[] } | { any: ChallengeCondition[] };

export type ChallengeEntry = { label: string; condition: ChallengeCondition };

export type IssuedChallenge = {
  id: string;
  scope: ChallengeScope;
  tier: ChallengeTier | "tier1" | "tier2" | "tier3";
  label: string;
  condition: ChallengeCondition;
  complete: boolean;
};

// Each season/career tier slot is either a single entry (the original 6 positions, unchanged)
// or an array of interchangeable variant entries (QB/MIKE's tripled pools) -- one variant gets
// picked per (position, prospect, season|career) via the same seeded pickIndex weekly already
// uses, so the shown label stays stable across repeated grading passes within that scope instead
// of reshuffling every advance.
type MilestonePosition = {
  weekly: { bronze: ChallengeEntry[]; silver: ChallengeEntry[]; gold: ChallengeEntry[] };
  season: Array<ChallengeEntry | ChallengeEntry[]>;
  career: Array<ChallengeEntry | ChallengeEntry[]>;
};

function milestoneFor(position: string): MilestonePosition | null {
  const catalog = immortalityMilestones as Record<string, unknown>;
  const row = catalog[position.toUpperCase()];
  if (!row || typeof row !== "object") return null;
  return row as MilestonePosition;
}

function num(stats: Record<string, number>, key: string): number {
  return Number(stats[key] ?? 0) || 0;
}

/** Computed once per grading pass and merged into the raw stats map before evaluation -- mirrors
 * what the old regex parser derived ad hoc per clause (totalTd/takeaways/turnovers/scrimmage),
 * plus two rate stats (ypc/ypr) the old parser handled via its own regex branches. A rate stat is
 * only set when its denominator is > 0, so a condition referencing it naturally fails closed
 * (stats[stat] == null in evaluateChallengeCondition) instead of dividing by zero into NaN. */
export function derivedChallengeStats(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...raw };
  out.total_tds = num(raw, "pass_tds") + num(raw, "rush_tds") + num(raw, "receiving_tds") + num(raw, "defensive_tds");
  out.takeaways = num(raw, "interceptions") + num(raw, "forced_fumbles") + num(raw, "fumble_recoveries");
  out.turnovers = num(raw, "interceptions_thrown") + num(raw, "rushing_fumbles");
  out.scrimmage_yards = num(raw, "rush_yards") + num(raw, "receiving_yards");
  const rushAttempts = num(raw, "rush_attempts");
  if (rushAttempts > 0) out.ypc = num(raw, "rush_yards") / rushAttempts;
  const receptions = num(raw, "receptions");
  if (receptions > 0) out.ypr = num(raw, "receiving_yards") / receptions;
  // Two catalog entries (SS season tier2, SS career tier3) phrase a genuinely combined
  // threshold ("8 combined sacks+INT", "30 FF+sacks combined") rather than two separate
  // requirements -- narrow derived stats for exactly those two cases, not general-purpose.
  out.sacks_plus_interceptions = num(raw, "sacks") + num(raw, "interceptions");
  out.forced_fumbles_plus_sacks = num(raw, "forced_fumbles") + num(raw, "sacks");
  return out;
}

/** Evaluates a structured challenge condition against already-derived stats (see
 * derivedChallengeStats). Fails CLOSED: a condition referencing a stat outside
 * SUPPORTED_CHALLENGE_STATS, or one the stats map has no value for, returns false rather than
 * true. This replaces the old string parser's `return true` fallthrough for any clause it
 * couldn't recognize -- confirmed live, that let malformed catalog entries (e.g. "pressure if
 * available") silently auto-complete regardless of actual stats. */
export function evaluateChallengeCondition(condition: ChallengeCondition, stats: Record<string, number>): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateChallengeCondition(c, stats));
  if ("any" in condition) return condition.any.some((c) => evaluateChallengeCondition(c, stats));
  if (!SUPPORTED_CHALLENGE_STATS.has(condition.stat)) return false;
  const actual = stats[condition.stat];
  if (actual == null || !Number.isFinite(actual)) return false;
  return condition.op === "gte" ? actual >= condition.value : actual <= condition.value;
}

/** Condition-family classes for elevatePromotionCondition below -- how a stat's promotion-
 * opportunity bar should move relative to its ordinary Gold threshold. Per the Dev Promotion
 * Overhaul deep-dive (section 12): raw volume counts get a flat percentage bump, ratios get a
 * smaller one, capped/percentage-style stats move a fraction of the remaining distance toward
 * their natural ceiling instead of multiplying (multiplying a rating that's already near its max
 * would blow past 100%), and turnover-style "fewer is better" stats tighten by one discrete step
 * rather than scaling. */
type PromotionElevationClass = "volume" | "ratio" | "boundedPercent" | "penalty";

const PROMOTION_ELEVATION_CLASS: Record<StatKey, PromotionElevationClass> = {
  pass_yards: "volume", pass_tds: "volume", pass_attempts: "volume", pass_completions: "volume",
  completion_pct: "boundedPercent", passer_rating: "boundedPercent",
  rush_yards: "volume", rush_tds: "volume", rush_attempts: "volume", rush_20_plus: "volume",
  receiving_yards: "volume", receiving_tds: "volume", receptions: "volume",
  tackles: "volume", sacks: "volume", forced_fumbles: "volume", fumble_recoveries: "volume",
  interceptions: "volume", interceptions_thrown: "penalty",
  pass_deflections: "volume", defensive_tds: "volume", rushing_fumbles: "penalty",
  total_tds: "volume", takeaways: "volume", turnovers: "penalty", scrimmage_yards: "volume",
  ypc: "ratio", ypr: "ratio",
  sacks_plus_interceptions: "volume", forced_fumbles_plus_sacks: "volume",
};

// Madden doesn't report a passer rating scale beyond roughly this; used only as the ceiling a
// boundedPercent elevation moves a fraction toward, never displayed.
const BOUNDED_PERCENT_MAX: Partial<Record<StatKey, number>> = { completion_pct: 100, passer_rating: 158.3 };
const VOLUME_ELEVATION_RATE = 0.2; // +20%, middle of the deep-dive's recommended 15-25% band
const RATIO_ELEVATION_RATE = 0.1; // smaller than volume, per the deep-dive
const BOUNDED_PERCENT_ELEVATION_FRACTION = 0.35; // move 35% of the remaining distance to the ceiling
const PENALTY_TIGHTEN_STEP = 1; // one discrete step tighter, not a percentage

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Elevates one Gold StatCondition into its promotion-opportunity equivalent -- same stat, a
 * harder threshold, chosen by the stat's PromotionElevationClass rather than a flat multiplier
 * over the whole stat line. Replaces the old "divide every stat in the player's box score by
 * 1.5, then re-check the unmodified Gold condition" approach, which (a) hit every condition
 * family the same way regardless of what it actually measured, and (b) silently compounded with
 * rivalry-week stat elevation (see xp-awards.service.ts's RIVALRY_CHALLENGE_ELEVATION) into an
 * effective ~1.725x bar whenever a promotion opportunity fell on a rivalry week. Evaluate the
 * *elevated condition* against the player's *real, unelevated* stats instead -- rivalry and
 * promotion elevation no longer touch the same stat line at all.
 * Returns null (fail closed) for any condition this function doesn't recognize -- per the deep-
 * dive: "unsupported/ambiguous condition: fail closed and do not create the opportunity until
 * supported," rather than guessing at a multiplier for a stat family nobody has classified yet. */
export function elevatePromotionCondition(condition: ChallengeCondition): ChallengeCondition | null {
  if ("all" in condition) {
    const parts = condition.all.map(elevatePromotionCondition);
    if (parts.some((part) => part == null)) return null;
    return { all: parts as ChallengeCondition[] };
  }
  if ("any" in condition) {
    const parts = condition.any.map(elevatePromotionCondition);
    if (parts.some((part) => part == null)) return null;
    return { any: parts as ChallengeCondition[] };
  }
  if (!SUPPORTED_CHALLENGE_STATS.has(condition.stat)) return null;
  const elevationClass = PROMOTION_ELEVATION_CLASS[condition.stat];
  if (condition.op === "gte") {
    switch (elevationClass) {
      case "volume":
        return { ...condition, value: Math.round(condition.value * (1 + VOLUME_ELEVATION_RATE)) };
      case "ratio":
        return { ...condition, value: roundToTenth(condition.value * (1 + RATIO_ELEVATION_RATE)) };
      case "boundedPercent": {
        const max = BOUNDED_PERCENT_MAX[condition.stat] ?? condition.value;
        const elevated = condition.value + (max - condition.value) * BOUNDED_PERCENT_ELEVATION_FRACTION;
        return { ...condition, value: Math.min(max, roundToTenth(elevated)) };
      }
      // A `gte` penalty condition ("interceptions_thrown >= X") doesn't occur in this catalog
      // today (penalties are always caps), but tightening one still means raising the floor.
      case "penalty":
        return { ...condition, value: condition.value + PENALTY_TIGHTEN_STEP };
      default:
        return null;
    }
  }
  // op === "lte"
  switch (elevationClass) {
    case "penalty":
      return { ...condition, value: Math.max(0, condition.value - PENALTY_TIGHTEN_STEP) };
    case "boundedPercent":
      return { ...condition, value: Math.max(0, roundToTenth(condition.value * (1 - BOUNDED_PERCENT_ELEVATION_FRACTION))) };
    case "ratio":
      return { ...condition, value: Math.max(0, roundToTenth(condition.value * (1 - RATIO_ELEVATION_RATE))) };
    // An `lte` volume condition isn't expected in this catalog either -- tighten conservatively
    // rather than leaving it unelevated.
    case "volume":
      return { ...condition, value: Math.max(0, Math.round(condition.value * (1 - VOLUME_ELEVATION_RATE))) };
    default:
      return null;
  }
}

// Never satisfiable -- only used as a defensive fallback if a catalog pool is ever empty
// (shouldn't happen; every position's pools are always populated), so grading fails closed
// instead of crashing on an undefined entry.
const UNREACHABLE_CONDITION: ChallengeCondition = { stat: "tackles", op: "gte", value: Number.MAX_SAFE_INTEGER };

function pickIndex(seed: string, length: number, salt: number): number {
  let hash = salt >>> 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

export function issuedWeeklyChallenges(input: {
  position: string;
  seed: string;
  stats: Record<string, number>;
}): IssuedChallenge[] {
  const row = milestoneFor(input.position);
  if (!row) return [];
  const derived = derivedChallengeStats(input.stats);
  const tiers: ChallengeTier[] = ["bronze", "silver", "gold"];
  return tiers.map((tier, index) => {
    const pool = row.weekly[tier];
    const entry = pool[pickIndex(input.seed, pool.length, index + 1)] ?? pool[0];
    return {
      id: `weekly:${tier}`,
      scope: "weekly",
      tier,
      label: entry?.label ?? "",
      condition: entry?.condition ?? UNREACHABLE_CONDITION,
      complete: entry?.label ? evaluateChallengeCondition(entry.condition, derived) : false,
    };
  });
}

function resolveEntry(entry: ChallengeEntry | ChallengeEntry[], seed: string, salt: number): ChallengeEntry | undefined {
  if (Array.isArray(entry)) return entry[pickIndex(seed, entry.length, salt)] ?? entry[0];
  return entry;
}

export function issuedSeasonChallenges(position: string, stats: Record<string, number>, seed = position): IssuedChallenge[] {
  const row = milestoneFor(position);
  if (!row) return [];
  const derived = derivedChallengeStats(stats);
  const tiers = ["tier1", "tier2", "tier3"] as const;
  return row.season.map((raw, index) => {
    const entry = resolveEntry(raw, seed, index + 1);
    return {
      id: `season:${tiers[index] ?? "tier1"}`,
      scope: "season" as const,
      tier: tiers[index] ?? "tier1",
      label: entry?.label ?? "",
      condition: entry?.condition ?? UNREACHABLE_CONDITION,
      complete: entry?.label ? evaluateChallengeCondition(entry.condition, derived) : false,
    };
  });
}

export function issuedCareerChallenges(position: string, stats: Record<string, number>, seed = position): IssuedChallenge[] {
  const row = milestoneFor(position);
  if (!row) return [];
  const derived = derivedChallengeStats(stats);
  const tiers = ["tier1", "tier2", "tier3"] as const;
  return row.career.map((raw, index) => {
    const entry = resolveEntry(raw, seed, index + 1);
    return {
      id: `career:${tiers[index] ?? "tier1"}`,
      scope: "career" as const,
      tier: tiers[index] ?? "tier1",
      label: entry?.label ?? "",
      condition: entry?.condition ?? UNREACHABLE_CONDITION,
      complete: entry?.label ? evaluateChallengeCondition(entry.condition, derived) : false,
    };
  });
}

export function pointsForWeeklyTier(tier: ChallengeTier): number {
  return WEEKLY_CHALLENGE_POINTS[tier];
}

export function pointsForSeasonTier(tier: "tier1" | "tier2" | "tier3"): number {
  return SEASON_MILESTONE_POINTS[tier];
}

export function pointsForCareerTier(tier: "tier1" | "tier2" | "tier3"): number {
  return CAREER_MILESTONE_POINTS[tier === "tier1" ? "minor" : tier === "tier2" ? "major" : "historic"];
}

export function recordSetPoints(): number {
  return RECORD_SET_BONUS_POINTS;
}

export function awardablePoints(base: number, modifiers: CharacteristicModifiers): number {
  return applyXpEarnBonus(base, modifiers);
}

export function isImmortalityChallengePosition(position: string): position is ImmortalityPosition {
  return Boolean(milestoneFor(position));
}
