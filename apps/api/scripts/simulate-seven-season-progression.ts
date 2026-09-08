/**
 * RTI Pass 11 (Seven-Season Simulation): projects how much Player XP a low/average/strong/elite
 * prospect would realistically bank across a 7-season career under the Pass 4-recalibrated
 * challenge catalog, then checks that against a Progression Tree's real node costs (Tier2=50,
 * Tier3=90, Tier4=120 XP per branch node; two branch-less universal Tier2/3 pairs at the same
 * cost) -- RTI's own league hasn't played 7 real seasons yet, so this reuses the same one real,
 * fully-played Madden league Pass 4 used ("M27 - The OG REC").
 *
 * Design: rather than inventing profiles from nothing, each of the 4 profiles is a REAL player
 * from that league, picked by percentile rank (p10/p50/p85/p99) of a composite "challenge
 * quality" score -- the average fraction of that tier's weekly-variant pool their own real weeks
 * would have completed (bronze weight x1, silver x2, gold x4, since gold is the rarest/most
 * skill-indicative). A prospect's whole 7-season career is then assumed to play out at that same
 * real player's demonstrated level every week/season -- a simplifying assumption stated plainly
 * here since no real 7-season history exists yet to check it against.
 *
 * Season/career milestone tiers are NOT mutually exclusive in the live grading code (xp-awards.
 * service.ts loops every issued season/career challenge and credits every one that's complete,
 * not just the highest) -- so hitting a harder tier's threshold also banks the easier tiers' XP
 * when the real stats clear all three, exactly mirrored here.
 *
 * A Progression Tree is keyed by position_group (QB, MIKE/LB, DB, HB, WR_TE), but the weekly/
 * season/career challenge catalog in milestones_v2.json is keyed by the real, granular position
 * (challenges.ts's milestoneFor() looks up CB/FS/SS separately, not "DB"; WR/TE separately, not
 * "WR_TE") -- each real position has its own hand-tuned variant pools. So a multi-position tree
 * pools candidates from every real position it covers (e.g. DB pools CB+FS+SS), but each
 * candidate is still scored against THEIR OWN real position's variant pools, not a shared one.
 *
 * Usage: pnpm --filter @rec/api exec tsx scripts/simulate-seven-season-progression.ts [--apply] [--trees=name,name]
 * Without --apply, only reports the projection and a proposed cost-scale factor. With --apply,
 * scales every Tier2-4 xp_cost in the selected trees' catalog files by that factor. Trees default
 * to every catalog EXCEPT qb/mike (already scaled by this same tool in Pass 11 -- re-pooling them
 * with a still-unscaled tree would badly miscalibrate both; re-run with --trees=qb,mike alone if
 * they ever need a fresh recalibration). Pass --trees=db,hb,wr_te explicitly to be sure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../src/lib/supabase.js";
import {
  derivedChallengeStats,
  evaluateChallengeCondition,
  pointsForCareerTier,
  pointsForSeasonTier,
  pointsToXp,
  WEEKLY_CHALLENGE_POINTS,
  WEEKLY_SWEEP_BONUS_PCT,
  type ChallengeCondition,
} from "@rec/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, "..", "..", "..", "packages", "shared", "src", "immortality", "config");
const MILESTONES_PATH = path.join(CONFIG_DIR, "milestones_v2.json");

const REAL_MADDEN_LEAGUE_ID = "e342e8bd-71ad-40f6-96f9-2731d702755c"; // "M27 - The OG REC" -- full real season
const SEASONS_TO_PROJECT = 7;
const WEEKS_PER_SEASON = 18; // real regular-season length in this league; playoffs excluded (not every prospect reaches them)
const MIN_WEEKS_FOR_A_PROFILE_CANDIDATE = 8; // needs a real, representative sample of that player's season

// Five real Progression Trees exist today (QB, MIKE, DB, HB, WR_TE); Owner earns XP through a
// wholly different win/season-completion mechanic (Pass 7) and isn't in scope here. `positions`
// lists every real, granular position (milestones_v2.json / challenges.ts's milestoneFor() keys)
// that tree's characteristic catalog covers -- QB/MIKE/HB map 1:1, DB and WR_TE pool several.
const ALL_TREES: Array<{ name: string; catalogFile: string; positions: string[] }> = [
  { name: "qb", catalogFile: "characteristics_QB.json", positions: ["QB"] },
  { name: "mike", catalogFile: "characteristics_LB.json", positions: ["MIKE"] },
  { name: "db", catalogFile: "characteristics_DB.json", positions: ["CB", "FS", "SS"] },
  { name: "hb", catalogFile: "characteristics_HB.json", positions: ["HB"] },
  { name: "wr_te", catalogFile: "characteristics_WR_TE.json", positions: ["WR", "TE"] },
];

// Defaults to every tree EXCEPT qb/mike -- see the module doc comment above for why re-pooling
// those (already scaled by Pass 11) alongside a still-unscaled tree would miscalibrate both.
function selectedTrees(): typeof ALL_TREES {
  const arg = process.argv.find((a) => a.startsWith("--trees="));
  if (!arg) return ALL_TREES.filter((t) => t.name !== "qb" && t.name !== "mike");
  const names = new Set(arg.slice("--trees=".length).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const picked = ALL_TREES.filter((t) => names.has(t.name));
  if (!picked.length) throw new Error(`--trees matched nothing (got "${arg}"). Valid names: ${ALL_TREES.map((t) => t.name).join(", ")}`);
  return picked;
}

const PROFILES = [
  { name: "low", percentile: 0.10 },
  { name: "average", percentile: 0.50 },
  { name: "strong", percentile: 0.85 },
  { name: "elite", percentile: 0.99 },
] as const;

function numericStats(stats: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function withCompletionPct(raw: Record<string, number>): Record<string, number> {
  const out = { ...raw };
  const attempts = out.pass_attempts ?? 0;
  if (attempts > 0 && out.pass_completions != null) out.completion_pct = (out.pass_completions / attempts) * 100;
  return out;
}

function sumRaw(rows: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) for (const [key, value] of Object.entries(row)) out[key] = (out[key] ?? 0) + value;
  return out;
}

/** Average, over `weeks`, of the fraction of `variants` a week's derived stats satisfy --
 * an expected-value stand-in for "if a random one of this tier's variants got issued that
 * week, how likely is it to be completed," since which exact variant a real prospect is
 * assigned is a deterministic-but-effectively-random seeded pick (challenges.ts's issuance
 * logic), not something this offline script replays week-by-week. */
function avgVariantHitRate(weeks: Array<Record<string, number>>, variants: Array<{ condition: ChallengeCondition }>): number {
  if (weeks.length === 0 || variants.length === 0) return 0;
  let total = 0;
  for (const week of weeks) {
    let hits = 0;
    for (const variant of variants) if (evaluateChallengeCondition(variant.condition, week)) hits++;
    total += hits / variants.length;
  }
  return total / weeks.length;
}

function percentileIndex(sortedAscendingLength: number, percentile: number): number {
  return Math.min(sortedAscendingLength - 1, Math.max(0, Math.round(percentile * (sortedAscendingLength - 1))));
}

/** Averages a small window of real players centered on a percentile rank, rather than reading
 * off a single real player at that exact rank -- one real player's season is noisy (a handful of
 * blowouts or a short bench stint can swing their season/career aggregate independent of their
 * weekly-composite skill rank), and averaging smooths that out while staying fully real-data
 * grounded. Window is ~12% of the pool, floor 3 players, so small pools still get more than one
 * sample. */
function windowIndices(poolLength: number, percentile: number): number[] {
  const halfWindow = Math.max(1, Math.round(poolLength * 0.06));
  const center = percentileIndex(poolLength, percentile);
  const start = Math.max(0, center - halfWindow);
  const end = Math.min(poolLength - 1, center + halfWindow);
  const indices: number[] = [];
  for (let i = start; i <= end; i++) indices.push(i);
  return indices;
}

async function main() {
  const applyChanges = process.argv.includes("--apply");
  const catalog = JSON.parse(fs.readFileSync(MILESTONES_PATH, "utf8"));
  const trees = selectedTrees();

  console.log(`Trees: ${trees.map((t) => t.name).join(", ")}`);
  console.log(`Loading real player-week stats from league ${REAL_MADDEN_LEAGUE_ID}...\n`);
  const { data, error } = await supabase.from("rec_player_weekly_stats")
    .select("position, player_id, stats")
    .eq("league_id", REAL_MADDEN_LEAGUE_ID)
    .eq("season_stage", "regular_season")
    .in("position", trees.flatMap((t) => t.positions));
  if (error) throw error;

  const pooledEvidence: Array<{ averageProjection: number; fullTreeCost: number; catalogFile: string }> = [];

  for (const tree of trees) {
    // Each candidate's full 7-season XP is computed here, individually, using THEIR OWN real
    // position's weekly/season/career variant pools -- a multi-position tree (DB pools CB+FS+SS,
    // WR_TE pools WR+TE) then just concatenates candidates across positions before percentile
    // ranking. This is a deliberate departure from computing one shared "average raw stats" per
    // window (the original QB/MIKE-only version of this script) -- averaging raw counting stats
    // across different real positions (e.g. a CB's INTs with an SS's tackles) wouldn't mean
    // anything, so each candidate's XP is computed standalone first, and only the final XP
    // numbers are window-averaged.
    type Candidate = { playerId: string; position: string; score: number; xpAfter7Seasons: number; wBronze: number; wSilver: number; wGold: number };
    const candidates: Candidate[] = [];

    for (const position of tree.positions) {
      const rowsForPosition = (data ?? []).filter((row) => row.position === position);
      const weeksByPlayer = new Map<string, Array<Record<string, number>>>();
      // Raw (pre-derived) per-week counting stats -- kept separate from the derived weekly view
      // above so season/career aggregates can be built by summing RAW counts at a normalized pace
      // and deriving rate stats (completion_pct/ypc/ypr) only once, afterward. Deriving first and
      // then summing/scaling rates across weeks would double-count or mis-scale a percentage.
      const rawWeeksByPlayer = new Map<string, Array<Record<string, number>>>();
      for (const row of rowsForPosition) {
        const playerId = String(row.player_id ?? "");
        if (!playerId) continue;
        const raw = numericStats(row.stats as Record<string, unknown>);
        const stats = derivedChallengeStats(withCompletionPct(raw));
        (weeksByPlayer.get(playerId) ?? weeksByPlayer.set(playerId, []).get(playerId)!).push(stats);
        (rawWeeksByPlayer.get(playerId) ?? rawWeeksByPlayer.set(playerId, []).get(playerId)!).push(raw);
      }

      const posCatalog = catalog[position];
      if (!posCatalog) { console.log(`  (no milestone catalog for position "${position}" -- skipping)`); continue; }
      const bronzeVariants = posCatalog.weekly.bronze as Array<{ condition: ChallengeCondition }>;
      const silverVariants = posCatalog.weekly.silver as Array<{ condition: ChallengeCondition }>;
      const goldVariants = posCatalog.weekly.gold as Array<{ condition: ChallengeCondition }>;
      // Each season/career tier slot is either a single entry (the original 6 positions) or an
      // array of interchangeable variants (QB/MIKE's tripled pools) -- see challenges.ts's
      // MilestonePosition comment. Normalize both to "the pool of variants for this tier" so
      // avgVariantHitRate (which treats a size-1 pool as "must hit this one exactly") works
      // identically either way.
      const normalizeTiers = (raw: unknown): Array<Array<{ condition: ChallengeCondition }>> =>
        (raw as Array<{ condition: ChallengeCondition } | Array<{ condition: ChallengeCondition }>>).map((tier) => (Array.isArray(tier) ? tier : [tier]));
      const seasonTiers = normalizeTiers(posCatalog.season);
      const careerTiers = normalizeTiers(posCatalog.career);

      for (const [playerId, weeks] of weeksByPlayer) {
        if (weeks.length < MIN_WEEKS_FOR_A_PROFILE_CANDIDATE) continue;
        const wBronze = avgVariantHitRate(weeks, bronzeVariants);
        const wSilver = avgVariantHitRate(weeks, silverVariants);
        const wGold = avgVariantHitRate(weeks, goldVariants);
        const rawWeeks = rawWeeksByPlayer.get(playerId) ?? [];
        const pace = WEEKS_PER_SEASON / rawWeeks.length; // normalizes a partial real sample (e.g. 8 of 18 weeks) to a full season at the SAME demonstrated per-game rate
        const paceNormalizedSeasonRaw: Record<string, number> = {};
        for (const [key, value] of Object.entries(sumRaw(rawWeeks))) paceNormalizedSeasonRaw[key] = value * pace;
        const seasonRaw = derivedChallengeStats(withCompletionPct(paceNormalizedSeasonRaw));

        let seasonPoints = 0;
        seasonPoints += wBronze * WEEKLY_CHALLENGE_POINTS.bronze * WEEKS_PER_SEASON;
        seasonPoints += wSilver * WEEKLY_CHALLENGE_POINTS.silver * WEEKS_PER_SEASON;
        seasonPoints += wGold * WEEKLY_CHALLENGE_POINTS.gold * WEEKS_PER_SEASON;
        const sweepProbPerWeek = wBronze * wSilver * wGold; // independence approximation
        const sweepBonusPerWeek = sweepProbPerWeek * WEEKLY_SWEEP_BONUS_PCT * (WEEKLY_CHALLENGE_POINTS.bronze + WEEKLY_CHALLENGE_POINTS.silver + WEEKLY_CHALLENGE_POINTS.gold);
        seasonPoints += sweepBonusPerWeek * WEEKS_PER_SEASON;

        const seasonMilestoneProbs = seasonTiers.map((variants) => avgVariantHitRate([seasonRaw], variants));
        seasonPoints += seasonMilestoneProbs[0] * pointsForSeasonTier("tier1");
        seasonPoints += seasonMilestoneProbs[1] * pointsForSeasonTier("tier2");
        seasonPoints += seasonMilestoneProbs[2] * pointsForSeasonTier("tier3");

        // Career aggregate sums the RAW (pre-derived) per-season counts over 7 seasons, then
        // derives rate stats (completion_pct/ypc/ypr) once from that summed total -- summing an
        // already-derived percentage 7x would be meaningless. Stable-level-career assumption
        // stated in the module doc comment above.
        const careerRawCounts = sumRaw(new Array(SEASONS_TO_PROJECT).fill(paceNormalizedSeasonRaw));
        const careerRaw = derivedChallengeStats(withCompletionPct(careerRawCounts));
        const careerMilestoneProbs = careerTiers.map((variants) => avgVariantHitRate([careerRaw], variants));
        const careerPoints =
          careerMilestoneProbs[0] * pointsForCareerTier("tier1") +
          careerMilestoneProbs[1] * pointsForCareerTier("tier2") +
          careerMilestoneProbs[2] * pointsForCareerTier("tier3");

        const totalRawPoints = seasonPoints * SEASONS_TO_PROJECT + careerPoints;
        const xpAfter7Seasons = pointsToXp(totalRawPoints);
        candidates.push({ playerId, position, score: wBronze * 1 + wSilver * 2 + wGold * 4, xpAfter7Seasons, wBronze, wSilver, wGold });
      }
    }
    candidates.sort((a, b) => a.score - b.score);

    console.log(`=== ${tree.name} tree (${tree.positions.join("/")}): ${candidates.length} eligible real players, >=${MIN_WEEKS_FOR_A_PROFILE_CANDIDATE} weeks each ===`);
    if (candidates.length < 5) {
      console.log("  Skipping -- too few eligible real players for a reliable percentile profile.\n");
      continue;
    }

    const projections: Array<{ name: string; xpAfter7Seasons: number }> = [];
    for (const profile of PROFILES) {
      const window = windowIndices(candidates.length, profile.percentile).map((i) => candidates[i]);
      const wBronze = window.reduce((sum, c) => sum + c.wBronze, 0) / window.length;
      const wSilver = window.reduce((sum, c) => sum + c.wSilver, 0) / window.length;
      const wGold = window.reduce((sum, c) => sum + c.wGold, 0) / window.length;
      const xpAfter7Seasons = Math.round(window.reduce((sum, c) => sum + c.xpAfter7Seasons, 0) / window.length);
      projections.push({ name: profile.name, xpAfter7Seasons });
      console.log(
        `  ${profile.name.padEnd(8)} (${window.length} real players [${[...new Set(window.map((c) => c.position))].join("/")}], weekly bronze/silver/gold ~${(wBronze * 100).toFixed(0)}%/${(wSilver * 100).toFixed(0)}%/${(wGold * 100).toFixed(0)}%) ` +
        `-> ${xpAfter7Seasons} XP banked by end of Season 7`,
      );
    }

    const rawCatalog = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, tree.catalogFile), "utf8"));
    const tier2to4Nodes: Array<{ tier: number; branch: string | null; xp_cost: number }> = rawCatalog.characteristics.filter((c: { tier?: number }) => (c.tier ?? 1) >= 2);
    const oneBranchName = tier2to4Nodes.find((n) => n.branch)?.branch ?? null;
    const oneBranchCost = tier2to4Nodes.filter((n) => n.branch === oneBranchName).reduce((sum, n) => sum + n.xp_cost, 0);
    const universalCost = tier2to4Nodes.filter((n) => !n.branch).reduce((sum, n) => sum + n.xp_cost, 0);
    const fullTreeCost = oneBranchCost + universalCost;
    console.log(`  Full tree cost (one branch + both universal pairs): ${fullTreeCost} XP (branch ${oneBranchCost} + universal ${universalCost})`);

    const averageProjection = projections.find((p) => p.name === "average")!.xpAfter7Seasons;
    console.log(`  Average profile banks ${averageProjection} XP vs a ${fullTreeCost} XP full tree (raw ratio ${(averageProjection / fullTreeCost).toFixed(3)})`);
    console.log("");
    pooledEvidence.push({ averageProjection, fullTreeCost, catalogFile: tree.catalogFile });
  }

  // Every tree here is deliberately identical in starting cost structure (Tier2=50/Tier3=90/
  // Tier4=120 -- see Pass 6's shipped notes) -- applying a DIFFERENT multiplier per tree would
  // bake in an artifact of which real players this one league happened to have at each position,
  // not a real design difference. Pool every selected tree's evidence into one multiplier applied
  // uniformly to all of them, preserving that intentional parity (this is why qb/mike -- already
  // rescaled by Pass 11 -- default to excluded: pooling an already-right-sized tree with a still
  // 50/90/120 one would miscalibrate both).
  const pooledAverageXp = pooledEvidence.reduce((sum, e) => sum + e.averageProjection, 0);
  const pooledTreeCost = pooledEvidence.reduce((sum, e) => sum + e.fullTreeCost, 0);
  const rawMultiplier = pooledTreeCost > 0 ? pooledAverageXp / pooledTreeCost : 1;
  // A floor still guards against a truly degenerate near-zero result collapsing the tree to
  // nothing, but the raw ratio here (~0.05-0.07 independently for both positions) is a real,
  // robust, cross-position-consistent signal, not single-player noise -- it should actually move
  // costs, not be clamped away by a conservative band picked before this data existed.
  const multiplier = Math.max(0.05, Math.min(2.5, rawMultiplier));
  console.log(`Pooled: average profiles bank ${pooledAverageXp} XP total vs ${pooledTreeCost} XP total tree cost across ${pooledEvidence.length} tree(s).`);
  console.log(`Proposed uniform cost multiplier: x${multiplier.toFixed(3)} (raw ${rawMultiplier.toFixed(3)})`);
  if (!applyChanges) {
    console.log("\nDry run -- re-run with --apply to scale every Tier2-4 xp_cost field by this multiplier.");
    return;
  }

  for (const tree of trees) {
    const filePath = path.join(CONFIG_DIR, tree.catalogFile);
    const rawCatalog = JSON.parse(fs.readFileSync(filePath, "utf8"));
    let changed = 0;
    for (const c of rawCatalog.characteristics as Array<{ tier?: number; xp_cost?: number }>) {
      if ((c.tier ?? 1) < 2 || c.xp_cost == null) continue;
      c.xp_cost = Math.max(1, Math.round(c.xp_cost * multiplier));
      changed++;
    }
    fs.writeFileSync(filePath, JSON.stringify(rawCatalog, null, 2) + "\n");
    console.log(`Applied x${multiplier.toFixed(2)} to ${changed} Tier2-4 node(s) in ${tree.catalogFile}.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
