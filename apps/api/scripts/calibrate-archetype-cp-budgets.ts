/**
 * For each position and tier 2-5, computes the minimum bonus CP needed to raise a frozen
 * archetype template's estimated OVR from its base to the tier's growth target (Samuel,
 * 2026-08: T2 69->72, T3 75->78, T4 79->82, T5 82->86), using the real recalibrated OVR model
 * and the existing attribute-cost/floor-relation/quick-cluster rules. Greedily buys the
 * cheapest legal next point across every editable attribute (never below the template's frozen
 * floor) until the target OVR is reached, same mechanics as optimal-allocator.ts but stopping
 * at a target instead of exhausting the whole budget.
 *
 * Reports the MAX across a position's 3 archetype templates at each tier, since the tier's
 * advertised bonus CP must be enough regardless of which archetype the user picks.
 *
 * Usage: pnpm tsx apps/api/scripts/calibrate-archetype-cp-budgets.ts [position...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateRecPlayerOverall,
  evaluateRecAttributeCeiling,
  getRecAllAttributeCodes,
  getRecEffectiveAttributeMultiplier,
  normalizeRecOvrPosition,
  recBaseMarginalCost,
  REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS,
  REC_PACKAGE_RULES,
  REC_POSITION_QUICK_CLUSTER_GAP,
  REC_QUICK_CLUSTER_ATTRIBUTES,
  REC_QUICK_CLUSTER_GAP_THRESHOLD,
  type RecOvrPosition,
  type RecPackageTier,
  type RecPlayerAttributes,
} from "@rec/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_PATH = path.join(__dirname, "data", "madden27", "archetype-templates.generated.json");

const GROWTH_TARGET: Readonly<Record<RecPackageTier, number | null>> = {
  1: null, // template-only, no bonus CP
  2: 72,
  3: 78,
  4: 82,
  5: 86,
};

// Cost to go up one dev-trait tier from that tier's default (Samuel, 2026-08) — tuned down
// from the old flat 400/600/600/800 so it's a real alternative to spending the bonus CP on
// attributes instead, not a trivial add-on or an unaffordable luxury. Every position's actual
// bonus-CP budget is max(its own attribute-target cost, this), so nobody is short-changed on
// either option even though attribute-target cost varies wildly by position (Kicker vs LOLB).
export const REC_ARCHETYPE_DEV_UPGRADE_CP: Readonly<Record<RecPackageTier, number>> = {
  1: 0,
  2: 100,
  3: 200,
  4: 400,
  5: 700,
};

type TemplateRow = { tier: number; archetypeKey: string; archetypeLabel: string; ovr: number; attrs: Record<string, number> };

function ratingOf(attrs: RecPlayerAttributes, code: string): number {
  const raw = attrs[code];
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
}

function marginalCost(position: string, archetypeKey: string, code: string, nextRating: number): number {
  const multiplier = getRecEffectiveAttributeMultiplier("MADDEN", position, archetypeKey, code);
  return Math.max(1, Math.round(recBaseMarginalCost(nextRating) * multiplier));
}

function quickClusterOk(position: RecOvrPosition, attrs: RecPlayerAttributes): boolean {
  const maxGap = REC_POSITION_QUICK_CLUSTER_GAP[position];
  if (maxGap === undefined) return true;
  const ratings = REC_QUICK_CLUSTER_ATTRIBUTES.map((c) => ratingOf(attrs, c));
  const highest = Math.max(...ratings);
  if (highest < REC_QUICK_CLUSTER_GAP_THRESHOLD) return true;
  return highest - Math.min(...ratings) <= maxGap;
}

function raiseIsLegal(packageTier: RecPackageTier, position: RecOvrPosition, code: string, nextRating: number, attrs: RecPlayerAttributes): boolean {
  const cap = REC_PACKAGE_RULES[packageTier].highImpactAttributeCap;
  if (code in REC_HIGH_IMPACT_ATTRIBUTE_MULTIPLIERS && nextRating > cap) return false;
  const trial = { ...attrs, [code]: nextRating };
  const ceiling = evaluateRecAttributeCeiling(code, nextRating, trial);
  if (ceiling.applicable && ceiling.deficientAttributes.length > 0) return false;
  if (!quickClusterOk(position, trial)) return false;
  return true;
}

/** Spends CP greedily on whichever legal next point raises estimated OVR the most per CP spent
 * (never below `floor`) until estimated OVR reaches `targetOvr` or no legal move helps anymore.
 * Returns the CP spent to get there (or null if unreachable even at 99 across the board —
 * shouldn't happen for these modest targets). Optimizing for OVR-per-CP (not raw cheapest cost)
 * matters: an OVR-irrelevant attribute is cheap per point but moves the estimate ~0, so a
 * cheapest-first search wastes huge CP there instead of the few points that actually count. */
function cpToReachTarget(
  position: RecOvrPosition,
  archetypeKey: string,
  packageTier: RecPackageTier,
  floorAttrs: Record<string, number>,
  targetOvr: number,
): number | null {
  const pool = getRecAllAttributeCodes();
  const attrs: RecPlayerAttributes = { ...floorAttrs };
  let spent = 0;

  for (let safety = 0; safety < 20_000; safety += 1) {
    const currentOverall = estimateRecPlayerOverall(position, attrs);
    if (currentOverall.rawOverall >= targetOvr - 0.5) return spent;

    type Candidate = { code: string; nextRating: number; cost: number; score: number };
    let best: Candidate | null = null;
    for (const code of pool) {
      const current = ratingOf(attrs, code);
      if (current >= 99) continue;
      const nextRating = current + 1;
      if (!raiseIsLegal(packageTier, position, code, nextRating, attrs)) continue;
      const cost = marginalCost(position, archetypeKey, code, nextRating);
      const delta = estimateRecPlayerOverall(position, { ...attrs, [code]: nextRating }).rawOverall - currentOverall.rawOverall;
      if (delta <= 0) continue;
      const score = delta / cost;
      if (!best || score > best.score) best = { code, nextRating, cost, score };
    }
    if (!best) return null; // no legal move raises OVR anymore
    attrs[best.code] = best.nextRating;
    spent += best.cost;
  }
  return spent;
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const templates: Record<string, TemplateRow[]> = JSON.parse(fs.readFileSync(TEMPLATES_PATH, "utf8"));
  const positions = Object.keys(templates).filter((p) => only.length === 0 || only.includes(p));

  const summary: Record<string, Partial<Record<RecPackageTier, number>>> = {};

  for (const positionKey of positions) {
    const position = normalizeRecOvrPosition(positionKey);
    const rows = templates[positionKey]!;
    const byTier = new Map<number, TemplateRow[]>();
    for (const row of rows) {
      if (!byTier.has(row.tier)) byTier.set(row.tier, []);
      byTier.get(row.tier)!.push(row);
    }

    console.log(`\n${position}:`);
    summary[position] = {};
    for (const tier of [1, 2, 3, 4, 5] as RecPackageTier[]) {
      const target = GROWTH_TARGET[tier];
      if (target === null) { console.log(`  tier ${tier}: template-only, no bonus CP`); continue; }
      const tierRows = byTier.get(tier) ?? [];
      let maxCp = 0;
      for (const row of tierRows) {
        const cp = cpToReachTarget(position, row.archetypeKey, tier, row.attrs, target);
        if (cp === null) { console.log(`  tier ${tier} ${row.archetypeLabel}: UNREACHABLE`); continue; }
        maxCp = Math.max(maxCp, cp);
      }
      console.log(`  tier ${tier}: bonus CP needed (max across archetypes) = ${maxCp}  (base ${GROWTH_TARGET[(tier - 1) as RecPackageTier] ?? "n/a"} -> target ${target})`);
      summary[position]![tier] = maxCp;
    }
  }

  // Final budget per position/tier = max(computed attribute-target cost, dev-upgrade cost) so
  // every position can afford EITHER path, not just the cheaper of the two by accident.
  const finalBudgets: Record<string, Partial<Record<RecPackageTier, number>>> = {};
  for (const [position, tiers] of Object.entries(summary)) {
    finalBudgets[position] = {};
    for (const tier of [1, 2, 3, 4, 5] as RecPackageTier[]) {
      const targetCost = tiers[tier] ?? 0;
      finalBudgets[position]![tier] = Math.max(targetCost, REC_ARCHETYPE_DEV_UPGRADE_CP[tier]);
    }
  }

  const outPath = path.join(__dirname, "data", "madden27", "archetype-cp-budgets.generated.json");
  fs.writeFileSync(outPath, JSON.stringify({ devUpgradeCp: REC_ARCHETYPE_DEV_UPGRADE_CP, positionBudgets: finalBudgets }, null, 2));
  console.log(`\n\nWrote ${outPath}`);
  console.log("\n=== Final bonus-CP budgets (max of attribute-target cost, dev-upgrade cost) ===");
  console.log(JSON.stringify(finalBudgets, null, 2));
}

void main();
