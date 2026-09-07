/**
 * RTI Pass 4 (Historical Calibration): measures each weekly Bronze/Silver/Gold challenge
 * variant's real completion rate against actual, already-played Madden games -- the RTI
 * league itself has no real season played out yet, but "M27 - The OG REC" (a separate,
 * ordinary Madden 27 league on this platform) has a full real 18-week regular season + 3
 * playoff weeks of real human-played box scores, at the exact same 8 positions RTI's
 * challenge catalog covers (QB/HB/WR/TE/CB/FS/SS/MIKE all match real Madden position codes
 * 1:1 in this league -- no position-group mapping needed).
 *
 * Target bands (plan doc, Pass 4): Bronze 40-65%, Silver 20-40%, Gold 8-20%.
 *
 * Usage: pnpm --filter @rec/api exec tsx scripts/calibrate-challenge-completion-rates.ts [--apply]
 * Without --apply, only reports measured rates and proposed threshold changes. With --apply,
 * writes the adjusted thresholds directly into milestones_v2.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../src/lib/supabase.js";
import { derivedChallengeStats, evaluateChallengeCondition, immortalityMilestones, type ChallengeCondition } from "@rec/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MILESTONES_PATH = path.join(__dirname, "..", "..", "..", "packages", "shared", "src", "immortality", "config", "milestones_v2.json");

const REAL_MADDEN_LEAGUE_ID = "e342e8bd-71ad-40f6-96f9-2731d702755c"; // "M27 - The OG REC" -- full real season
const POSITIONS = ["QB", "HB", "WR", "TE", "CB", "FS", "SS", "MIKE"] as const;
const TIERS = ["bronze", "silver", "gold"] as const;
const TARGET_BAND: Record<(typeof TIERS)[number], [number, number]> = {
  bronze: [0.40, 0.65],
  silver: [0.20, 0.40],
  gold: [0.08, 0.20],
};

function numericStats(stats: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats ?? {})) {
    const num = Number(value);
    if (Number.isFinite(num)) out[key] = num;
  }
  return out;
}

function withCompletionPct(raw: Record<string, number>): Record<string, number> {
  const out = { ...raw };
  const attempts = out.pass_attempts ?? 0;
  if (attempts > 0 && out.pass_completions != null) out.completion_pct = (out.pass_completions / attempts) * 100;
  return out;
}

/** A condition's numeric thresholds, scaled by `factor` (>1 makes EVERY leaf harder -- a gte
 * threshold rises, a lte threshold falls -- monotonically decreasing the real completion rate
 * as factor increases, regardless of how many leaves or which op each uses; <1 the reverse).
 * This monotonicity is what makes binary-searching a single factor for a whole all/any tree
 * valid below. Rounds to a sane precision per stat (whole numbers for counting stats, one
 * decimal for rate stats like completion_pct/passer_rating/ypc/ypr). */
function scaleCondition(condition: ChallengeCondition, factor: number): ChallengeCondition {
  if ("all" in condition) return { all: condition.all.map((c) => scaleCondition(c, factor)) };
  if ("any" in condition) return { any: condition.any.map((c) => scaleCondition(c, factor)) };
  const isRateStat = condition.stat === "completion_pct" || condition.stat === "passer_rating" || condition.stat === "ypc" || condition.stat === "ypr";
  const raw = condition.op === "gte" ? condition.value * factor : condition.value / factor;
  const rounded = isRateStat ? Math.round(raw * 10) / 10 : Math.round(raw);
  return { ...condition, value: Math.max(condition.op === "gte" ? 1 : 0, rounded) };
}

/** Binary-searches a single uniform scale factor (see scaleCondition) so the condition's real
 * completion rate against `weeks` lands as close as possible to `targetRate` -- converges in one
 * script run instead of needing many small nudge-and-remeasure passes, since scaleCondition's
 * monotonicity guarantees the search always has a clear direction. 40 iterations is far more
 * than needed for a real dataset this size to stabilize, but it's cheap (pure in-memory
 * evaluation, no I/O) so there's no reason to cut it closer. */
function calibrateToTarget(condition: ChallengeCondition, weeks: Array<Record<string, number>>, targetRate: number): ChallengeCondition {
  const rateAt = (factor: number) => {
    const scaled = scaleCondition(condition, factor);
    return weeks.filter((w) => evaluateChallengeCondition(scaled, w)).length / weeks.length;
  };
  let lo = 0.02;
  let hi = 50;
  // rateAt is non-increasing in factor (see scaleCondition's doc comment).
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rateAt(mid) > targetRate) lo = mid; else hi = mid;
  }
  return scaleCondition(condition, (lo + hi) / 2);
}

async function main() {
  const applyChanges = process.argv.includes("--apply");

  console.log(`Loading real player-week stats from league ${REAL_MADDEN_LEAGUE_ID}...`);
  const { data, error } = await supabase.from("rec_player_weekly_stats")
    .select("position, stats")
    .eq("league_id", REAL_MADDEN_LEAGUE_ID)
    .neq("season_stage", "preseason")
    .in("position", POSITIONS as unknown as string[]);
  if (error) throw error;
  console.log(`Loaded ${data?.length ?? 0} real player-weeks.\n`);

  const weeksByPosition = new Map<string, Array<Record<string, number>>>();
  for (const row of data ?? []) {
    const pos = String(row.position ?? "");
    const stats = derivedChallengeStats(withCompletionPct(numericStats(row.stats as Record<string, unknown>)));
    (weeksByPosition.get(pos) ?? weeksByPosition.set(pos, []).get(pos)!).push(stats);
  }

  const catalog = JSON.parse(fs.readFileSync(MILESTONES_PATH, "utf8"));
  let changedCount = 0;
  let stuckCount = 0;

  for (const position of POSITIONS) {
    const weeks = weeksByPosition.get(position) ?? [];
    console.log(`=== ${position} (${weeks.length} real player-weeks) ===`);
    if (weeks.length < 30) {
      console.log(`  Skipping -- too few real samples (${weeks.length}) for a reliable rate.\n`);
      continue;
    }
    for (const tier of TIERS) {
      const variants: Array<{ label: string; condition: ChallengeCondition }> = catalog[position].weekly[tier];
      const [lo, hi] = TARGET_BAND[tier];
      const targetMid = (lo + hi) / 2;
      variants.forEach((variant, index) => {
        const completions = weeks.filter((w) => evaluateChallengeCondition(variant.condition, w)).length;
        const rate = completions / weeks.length;
        const inBand = rate >= lo && rate <= hi;
        const flag = inBand ? "  " : (rate < lo ? "▲ too hard" : "▼ too easy");
        console.log(`  ${tier}[${index}] ${(rate * 100).toFixed(1).padStart(5)}% ${flag}  "${variant.label}"`);
        if (!inBand) {
          // Most of this catalog measures far outside its target band against real data (some
          // variants 10-40+ points off) -- a small fixed nudge would need dozens of re-runs to
          // converge. Instead, directly solve for the single uniform scale factor that lands the
          // real completion rate at the MIDPOINT of the target band (not just barely inside it),
          // via calibrateToTarget's binary search -- exact, single-pass, still just a uniform
          // rescale of the original condition shape (never changes which stats it checks).
          const nextCondition = calibrateToTarget(variant.condition, weeks, targetMid);
          const newRate = weeks.filter((w) => evaluateChallengeCondition(nextCondition, w)).length / weeks.length;
          const stillOutOfBand = newRate < lo || newRate > hi;
          console.log(`           -> ${(newRate * 100).toFixed(1).padStart(5)}%      "${variant.label}" (recalibrated${stillOutOfBand ? ", still out of band -- floor-capped rare event" : ""})`);
          if (stillOutOfBand) {
            // A single countable event (1 sack, 1 forced fumble, 1 INT, a defensive TD) is
            // already at its floor -- gte can't drop below 1 without becoming a degenerate
            // always-true "0 or more" condition, so this variant's real rate is a genuine fact
            // about how rarely that event happens, not a threshold miscalibration. Documented
            // here instead of silently left to look "fixed" -- Pass 11's economy-wide simulation
            // is the right place to decide whether these need re-homing to a different tier or
            // broadening into an `any` alternative, not this per-variant threshold pass.
            catalog[position].weekly[tier][index] = {
              ...variant,
              condition: nextCondition,
              _note: `Pass 4 calibration: measured ${(newRate * 100).toFixed(1)}% against real M27 data, below the ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}% ${tier} band -- floor-capped rare single-event condition, cannot be scaled further without becoming degenerate. Flagged for Pass 11.`,
            };
            stuckCount++;
          } else {
            catalog[position].weekly[tier][index] = { ...variant, condition: nextCondition };
          }
          changedCount++;
        }
      });
    }
    console.log("");
  }

  if (applyChanges && changedCount > 0) {
    fs.writeFileSync(MILESTONES_PATH, JSON.stringify(catalog, null, 2) + "\n");
    console.log(`Applied ${changedCount} threshold adjustment(s) to ${MILESTONES_PATH} (${stuckCount} left flagged as floor-capped rare events for Pass 11).`);
  } else if (changedCount > 0) {
    console.log(`${changedCount} variant(s) are out of band. Re-run with --apply to write adjusted thresholds.`);
  } else {
    console.log("Every measured variant is already within its target band.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
