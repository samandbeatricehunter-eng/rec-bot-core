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

export type IssuedChallenge = {
  id: string;
  scope: ChallengeScope;
  tier: ChallengeTier | "tier1" | "tier2" | "tier3";
  label: string;
  complete: boolean;
};

// Each season/career tier slot is either a single label (the original 6 positions, unchanged)
// or an array of interchangeable variant labels (QB/MIKE's tripled pools) -- one variant gets
// picked per (position, prospect, season|career) via the same seeded pickIndex weekly already
// uses, so the shown label stays stable across repeated grading passes within that scope instead
// of reshuffling every advance.
type MilestonePosition = {
  weekly: { bronze: string[]; silver: string[]; gold: string[] };
  season: Array<string | string[]>;
  career: Array<string | string[]>;
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

function totalTd(stats: Record<string, number>): number {
  return num(stats, "pass_tds") + num(stats, "rush_tds") + num(stats, "receiving_tds") + num(stats, "defensive_tds");
}

function takeaways(stats: Record<string, number>): number {
  return num(stats, "interceptions") + num(stats, "forced_fumbles") + num(stats, "fumble_recoveries");
}

function turnovers(stats: Record<string, number>): number {
  return num(stats, "interceptions_thrown") + num(stats, "rushing_fumbles");
}

function scrimmage(stats: Record<string, number>): number {
  return num(stats, "rush_yards") + num(stats, "receiving_yards");
}

/** Best-effort evaluator for the human-readable milestone strings in milestones_v1.json. */
export function challengeComplete(label: string, stats: Record<string, number>): boolean {
  const text = label.toLowerCase().replace(/,/g, "");
  const clauses = text.split(/\s*(?:\+|\/| and | with |,)\s*/).map((part) => part.trim()).filter(Boolean);
  if (!clauses.length) return false;
  return clauses.every((clause) => clauseComplete(clause, stats, text));
}

function clauseComplete(clause: string, stats: Record<string, number>, full: string): boolean {
  const lte = clause.match(/<=\s*(\d+)\s*(turnovers?|ints?)/);
  if (lte) return (lte[2].startsWith("int") ? num(stats, "interceptions_thrown") : turnovers(stats)) <= Number(lte[1]);
  if (/0 turnovers/.test(clause) || /0 int\b/.test(clause)) return turnovers(stats) <= 0 && num(stats, "interceptions_thrown") <= 0;

  const ypc = clause.match(/(\d+(?:\.\d+)?)\s*ypc on (\d+)\+ carries/);
  if (ypc) {
    const att = num(stats, "rush_attempts");
    return att >= Number(ypc[2]) && att > 0 && num(stats, "rush_yards") / att >= Number(ypc[1]);
  }
  const ypr = clause.match(/(\d+(?:\.\d+)?)\s*ypr on (\d+)\+ (?:catches|receptions)/);
  if (ypr) {
    const rec = num(stats, "receptions");
    return rec >= Number(ypr[2]) && rec > 0 && num(stats, "receiving_yards") / rec >= Number(ypr[1]);
  }
  const comp = clause.match(/(\d+)% completion on (\d+)\+ attempts/);
  if (comp) return num(stats, "completion_pct") >= Number(comp[1]) && num(stats, "pass_attempts") >= Number(comp[2]);
  const rating = clause.match(/(\d+)\+? passer rating/);
  if (rating) return num(stats, "passer_rating") >= Number(rating[1]);

  const n = clause.match(/(\d+(?:\.\d+)?)/);
  const value = n ? Number(n[1]) : 1;
  if (/passing yards|pass yds/.test(clause)) return num(stats, "pass_yards") >= value;
  if (/passing td|pass td/.test(clause)) return num(stats, "pass_tds") >= value;
  if (/rushing yards|rush yds/.test(clause)) return num(stats, "rush_yards") >= value;
  if (/rushing td|rush td/.test(clause)) return num(stats, "rush_tds") >= value;
  if (/receiving yards|rec yds/.test(clause)) return num(stats, "receiving_yards") >= value;
  if (/receiving td|rec td/.test(clause)) return num(stats, "receiving_tds") >= value;
  if (/scrimmage/.test(clause)) return scrimmage(stats) >= value;
  if (/receptions|\brec\b/.test(clause) && !/rec yds|receiving/.test(clause)) return num(stats, "receptions") >= value;
  if (/total td/.test(clause)) return totalTd(stats) >= value;
  if (/\btd\b/.test(clause) && !/passing|rush|rec|defensive/.test(clause)) return totalTd(stats) >= value;
  if (/combined tackles|tackles|\btkl\b/.test(clause)) return num(stats, "tackles") >= value;
  if (/\btfl\b/.test(clause)) return num(stats, "tackles_for_loss") >= value;
  if (/sacks?/.test(clause)) return num(stats, "sacks") >= value;
  if (/takeaways?/.test(clause)) return takeaways(stats) >= value;
  if (/forced turnovers|forced fumble|\bff\b/.test(clause)) return num(stats, "forced_fumbles") >= value;
  if (/pass deflection/.test(clause)) return num(stats, "pass_deflections") >= value || takeaways(stats) >= value;
  if (/defensive td|def td/.test(clause)) return num(stats, "defensive_tds") >= value;
  if (/\bint\b|interceptions?/.test(clause) && !/thrown/.test(clause)) return num(stats, "interceptions") >= value;
  if (/impact play/.test(clause)) return takeaways(stats) >= 1 || num(stats, "sacks") >= 1;
  if (/attempts/.test(clause) && /pass/.test(full)) return num(stats, "pass_attempts") >= value;
  return true;
}

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
  const tiers: ChallengeTier[] = ["bronze", "silver", "gold"];
  return tiers.map((tier, index) => {
    const pool = row.weekly[tier];
    const label = pool[pickIndex(input.seed, pool.length, index + 1)] ?? pool[0] ?? "";
    return {
      id: `weekly:${tier}`,
      scope: "weekly",
      tier,
      label,
      complete: label ? challengeComplete(label, input.stats) : false,
    };
  });
}

function resolveLabel(entry: string | string[], seed: string, salt: number): string {
  if (typeof entry === "string") return entry;
  return entry[pickIndex(seed, entry.length, salt)] ?? entry[0] ?? "";
}

export function issuedSeasonChallenges(position: string, stats: Record<string, number>, seed = position): IssuedChallenge[] {
  const row = milestoneFor(position);
  if (!row) return [];
  const tiers = ["tier1", "tier2", "tier3"] as const;
  return row.season.map((entry, index) => {
    const label = resolveLabel(entry, seed, index + 1);
    return {
      id: `season:${tiers[index] ?? "tier1"}`,
      scope: "season" as const,
      tier: tiers[index] ?? "tier1",
      label,
      complete: label ? challengeComplete(label, stats) : false,
    };
  });
}

export function issuedCareerChallenges(position: string, stats: Record<string, number>, seed = position): IssuedChallenge[] {
  const row = milestoneFor(position);
  if (!row) return [];
  const tiers = ["tier1", "tier2", "tier3"] as const;
  return row.career.map((entry, index) => {
    const label = resolveLabel(entry, seed, index + 1);
    return {
      id: `career:${tiers[index] ?? "tier1"}`,
      scope: "career" as const,
      tier: tiers[index] ?? "tier1",
      label,
      complete: label ? challengeComplete(label, stats) : false,
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
