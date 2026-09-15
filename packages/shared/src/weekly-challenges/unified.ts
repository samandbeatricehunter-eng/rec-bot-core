import teamCatalogJson from "./config/final_team_challenge_catalog.json" with { type: "json" };
import playerCatalogJson from "./config/final_player_challenge_catalog.json" with { type: "json" };
import compatibilityJson from "./config/archetype_challenge_compatibility.json" with { type: "json" };
import architectureJson from "./config/unified_challenge_architecture.json" with { type: "json" };
import type { AggStatKey, CompareOp, TeamStatKey, WeeklyChallengeGameContext, WeeklyChallengeTier } from "./conditions.js";
import { evaluateWeeklyChallengeCondition, type WeeklyChallengeCondition } from "./conditions.js";
import { derivedChallengeStats, evaluateChallengeCondition, type ChallengeCondition, type StatKey } from "../immortality/challenges.js";

export type UnifiedAssignmentClass = "TEAM" | "PLAYER";
export type UnifiedLeagueMode = "STANDARD" | "RTI";
export type UnifiedChallengeSide = "offense" | "defense" | "special_teams" | "team";
export type UnifiedChallengePool = "standard" | "contextual";
export type UnifiedChallengeVolatility = "stable" | "moderate" | "high";

export type UnifiedTeamEligibility = {
  minRedZoneTrips?: number;
  minOpponentRedZoneTrips?: number;
  requires?: string[];
};

export type UnifiedPlayerMinimumUsage = {
  recentQbRushAttemptsPerGameMin?: number;
  recentRushAttemptsPerGameMin?: number;
  recentReceptionsPerGameMin?: number;
  recentTouchesPerGameMin?: number;
  gameRushAttemptsMin?: number;
  gameReceptionsMin?: number;
};

export type UnifiedPlayerCondition =
  | { stat: StatKey; op: CompareOp; value: number }
  | { all: UnifiedPlayerCondition[] }
  | { any: UnifiedPlayerCondition[] };

export type UnifiedTeamChallenge = {
  id: string;
  version: number;
  assignmentClass: "TEAM";
  side: UnifiedChallengeSide;
  name: string;
  family: string;
  pool: UnifiedChallengePool;
  volatility: UnifiedChallengeVolatility;
  selectionWeight: number;
  contextTags: string[];
  eligibility: UnifiedTeamEligibility;
  bronze: WeeklyChallengeCondition[];
  silverAdds: WeeklyChallengeCondition[];
  goldAdds: WeeklyChallengeCondition[];
  notes: string;
};

export type UnifiedPlayerChallenge = {
  id: string;
  version: number;
  assignmentClass: "PLAYER";
  positions: string[];
  name: string;
  family: string;
  archetypes: string[];
  minimumUsage: UnifiedPlayerMinimumUsage;
  volatility: UnifiedChallengeVolatility;
  selectionWeight: number;
  preferredContexts: string[];
  bronze: UnifiedPlayerCondition[];
  silverAdds: UnifiedPlayerCondition[];
  goldAdds: UnifiedPlayerCondition[];
  notes: string;
};

export type UnifiedChallenge = UnifiedTeamChallenge | UnifiedPlayerChallenge;

export type UnifiedTierResult = { tier: WeeklyChallengeTier; complete: boolean; lines: string[] };

export type UnifiedPlayerChallengeContext = {
  stats: Record<string, number>;
  recent: Record<string, number>;
  position: string;
  archetype?: string | null;
};

export type UnifiedTeamSelectionContext = {
  tags?: string[];
  redZoneTrips?: number;
  opponentRedZoneTrips?: number;
};

export const UNIFIED_CHALLENGE_CATALOG_VERSION = "rec-weekly-challenges-unified-v2";

// The uploaded package's raw catalog JSON spells this volatility value "high_variance"; every
// consumer here (blockHighVariance filters below, the UnifiedChallengeVolatility type itself)
// checks for "high". Left unreconciled, blockHighVariance silently matched zero entries in
// either catalog -- the no-consecutive-high-volatility fatigue rule was a complete no-op.
// Normalized once here, at the JSON-to-typed boundary, rather than editing the distilled source
// data or widening the type to carry two spellings for the same concept.
function normalizeVolatility(raw: unknown): UnifiedChallengeVolatility {
  return raw === "high_variance" ? "high" : (raw as UnifiedChallengeVolatility);
}

const TEAM_CATALOG = (teamCatalogJson as unknown as UnifiedTeamChallenge[])
  .map((entry) => ({ ...entry, volatility: normalizeVolatility(entry.volatility) }));
const PLAYER_CATALOG = (playerCatalogJson as unknown as UnifiedPlayerChallenge[])
  .map((entry) => ({ ...entry, volatility: normalizeVolatility(entry.volatility) }));

export function unifiedChallengeArchitecture() {
  return architectureJson;
}

export function unifiedArchetypeCompatibility() {
  return compatibilityJson;
}

export function unifiedTeamChallengeCatalog(input: { pool?: UnifiedChallengePool; side?: UnifiedChallengeSide } = {}): UnifiedTeamChallenge[] {
  return TEAM_CATALOG.filter((entry) => (!input.pool || entry.pool === input.pool) && (!input.side || entry.side === input.side));
}

// packages/shared/src/weekly-challenges/config/archetype_challenge_compatibility.json keys its
// archetype menus by generic position GROUP ("EDGE", "OLB"), not the Madden-specific split the
// challenge catalog itself and RTI prospects actually use ("LEDGE"/"REDGE", "WILL"/"SAM") --
// same M27 edge/backer normalization gap as the rest of this position-alias story (see
// normalizeChallengePosition above). Expand a group key to its real members here so a caller
// resolving "what archetypes/challenges exist for EDGE" gets the union of LEDGE+REDGE entries
// instead of zero, since no catalog entry is ever literally positioned "EDGE".
const POSITION_GROUP_MEMBERS: Partial<Record<string, string[]>> = {
  EDGE: ["LEDGE", "REDGE"],
  OLB: ["WILL", "SAM"],
};

export function unifiedPlayerChallengeCatalog(input: { position?: string; archetype?: string | null; contexts?: string[] } = {}): UnifiedPlayerChallenge[] {
  const position = input.position ? normalizeChallengePosition(input.position) : null;
  const positionMatches = position ? (POSITION_GROUP_MEMBERS[position] ?? [position]) : null;
  const archetype = normalizeArchetype(input.archetype);
  const contexts = new Set(input.contexts ?? []);
  return PLAYER_CATALOG.filter((entry) => {
    if (positionMatches && !entry.positions.map(normalizeChallengePosition).some((p) => positionMatches.includes(p))) return false;
    if (archetype && !entry.archetypes.includes("*") && !entry.archetypes.map(normalizeArchetype).includes(archetype)) return false;
    if (entry.preferredContexts.length && contexts.size && !entry.preferredContexts.some((tag) => contexts.has(tag))) return false;
    return true;
  });
}

export function unifiedChallengeById(id: string): UnifiedChallenge | undefined {
  return TEAM_CATALOG.find((entry) => entry.id === id) ?? PLAYER_CATALOG.find((entry) => entry.id === id);
}

export function normalizeChallengePosition(position: string): string {
  const value = position.trim().toUpperCase();
  if (value === "LE" || value === "RE") return value;
  if (value === "LEDGE" || value === "REDGE") return value;
  if (value === "MLB") return "MIKE";
  if (value === "LOLB") return "WILL";
  if (value === "ROLB") return "SAM";
  return value;
}

export function normalizeArchetype(archetype?: string | null): string | null {
  if (!archetype) return null;
  return archetype.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function pickIndex(seed: string, length: number, salt: number): number {
  let hash = salt >>> 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

export function pickUnifiedTeamChallenge(input: {
  seed: string;
  side?: UnifiedChallengeSide;
  pool?: UnifiedChallengePool;
  excludeIds?: string[];
  sameFamilyPenalty?: string[];
  blockHighVariance?: boolean;
  context?: UnifiedTeamSelectionContext;
}): UnifiedTeamChallenge | undefined {
  const excluded = new Set(input.excludeIds ?? []);
  const penalized = new Set(input.sameFamilyPenalty ?? []);
  const pool = unifiedTeamChallengeCatalog({ pool: input.pool, side: input.side })
    .filter((entry) => !excluded.has(entry.id))
    .filter((entry) => !(input.blockHighVariance && entry.volatility === "high"))
    .filter((entry) => unifiedTeamChallengeEligible(entry, input.context ?? {}));
  return weightedPick(pool, input.seed, 1, (entry) => penalized.has(entry.family) ? 0.35 : 1);
}

export function pickUnifiedPlayerChallenge(input: {
  seed: string;
  position: string;
  archetype?: string | null;
  contexts?: string[];
  excludeIds?: string[];
  sameFamilyPenalty?: string[];
  blockHighVariance?: boolean;
}): UnifiedPlayerChallenge | undefined {
  const excluded = new Set(input.excludeIds ?? []);
  const penalized = new Set(input.sameFamilyPenalty ?? []);
  const pool = unifiedPlayerChallengeCatalog({ position: input.position, archetype: input.archetype, contexts: input.contexts })
    .filter((entry) => !excluded.has(entry.id))
    .filter((entry) => !(input.blockHighVariance && entry.volatility === "high"));
  if (!pool.length) return undefined;
  return weightedPick(pool, input.seed, 2, (entry) => penalized.has(entry.family) ? 0.35 : 1);
}

function weightedPick<T extends { selectionWeight: number }>(pool: T[], seed: string, salt: number, weightMultiplier: (entry: T) => number = () => 1): T | undefined {
  const weighted = pool.map((entry) => ({ entry, weight: Math.max(0.01, entry.selectionWeight * weightMultiplier(entry)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return pool[pickIndex(seed, pool.length, salt)];
  const rollUnit = pickIndex(seed, 1_000_000, salt + 11) / 1_000_000;
  let roll = rollUnit * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.entry;
  }
  return weighted[weighted.length - 1]?.entry;
}

export function unifiedTeamChallengeEligible(entry: UnifiedTeamChallenge, context: UnifiedTeamSelectionContext): boolean {
  const tags = new Set(context.tags ?? []);
  if (entry.pool === "contextual" && entry.contextTags.length && !entry.contextTags.some((tag) => tags.has(tag))) return false;
  if (entry.eligibility.minRedZoneTrips != null && (context.redZoneTrips ?? 0) < entry.eligibility.minRedZoneTrips) return false;
  if (entry.eligibility.minOpponentRedZoneTrips != null && (context.opponentRedZoneTrips ?? 0) < entry.eligibility.minOpponentRedZoneTrips) return false;
  if (entry.eligibility.requires?.length && !entry.eligibility.requires.every((tag) => tags.has(tag))) return false;
  return true;
}

export function unifiedPlayerChallengeEligible(entry: UnifiedPlayerChallenge, context: UnifiedPlayerChallengeContext): boolean {
  const stats = derivedChallengeStats(context.stats);
  const recent = context.recent ?? {};
  const usage = entry.minimumUsage;
  if (usage.gameRushAttemptsMin != null && (stats.rush_attempts ?? 0) < usage.gameRushAttemptsMin) return false;
  if (usage.gameReceptionsMin != null && (stats.receptions ?? 0) < usage.gameReceptionsMin) return false;
  if (usage.recentQbRushAttemptsPerGameMin != null && (recent.qbRushAttemptsPerGame ?? 0) < usage.recentQbRushAttemptsPerGameMin) return false;
  if (usage.recentRushAttemptsPerGameMin != null && (recent.rushAttemptsPerGame ?? 0) < usage.recentRushAttemptsPerGameMin) return false;
  if (usage.recentReceptionsPerGameMin != null && (recent.receptionsPerGame ?? 0) < usage.recentReceptionsPerGameMin) return false;
  if (usage.recentTouchesPerGameMin != null && (recent.touchesPerGame ?? 0) < usage.recentTouchesPerGameMin) return false;
  return true;
}

export function evaluateUnifiedTeamChallenge(entry: UnifiedTeamChallenge, ctx: WeeklyChallengeGameContext): UnifiedTierResult[] {
  const bronzeOk = entry.bronze.every((condition) => evaluateWeeklyChallengeCondition(condition, ctx));
  const silverOk = bronzeOk && entry.silverAdds.every((condition) => evaluateWeeklyChallengeCondition(condition, ctx));
  const goldOk = silverOk && entry.goldAdds.every((condition) => evaluateWeeklyChallengeCondition(condition, ctx));
  return [
    { tier: "bronze", complete: bronzeOk, lines: entry.bronze.map(describeUnifiedTeamCondition) },
    { tier: "silver", complete: silverOk, lines: [...entry.bronze, ...entry.silverAdds].map(describeUnifiedTeamCondition) },
    { tier: "gold", complete: goldOk, lines: [...entry.bronze, ...entry.silverAdds, ...entry.goldAdds].map(describeUnifiedTeamCondition) },
  ];
}

export function evaluateUnifiedPlayerChallenge(entry: UnifiedPlayerChallenge, ctx: UnifiedPlayerChallengeContext): UnifiedTierResult[] {
  if (!unifiedPlayerChallengeEligible(entry, ctx)) {
    return ["bronze", "silver", "gold"].map((tier) => ({ tier: tier as WeeklyChallengeTier, complete: false, lines: [] }));
  }
  const stats = derivedChallengeStats(ctx.stats);
  const bronzeOk = entry.bronze.every((condition) => evaluateUnifiedPlayerCondition(condition, stats));
  const silverOk = bronzeOk && entry.silverAdds.every((condition) => evaluateUnifiedPlayerCondition(condition, stats));
  const goldOk = silverOk && entry.goldAdds.every((condition) => evaluateUnifiedPlayerCondition(condition, stats));
  return [
    { tier: "bronze", complete: bronzeOk, lines: entry.bronze.map(describeUnifiedPlayerCondition) },
    { tier: "silver", complete: silverOk, lines: [...entry.bronze, ...entry.silverAdds].map(describeUnifiedPlayerCondition) },
    { tier: "gold", complete: goldOk, lines: [...entry.bronze, ...entry.silverAdds, ...entry.goldAdds].map(describeUnifiedPlayerCondition) },
  ];
}

export function evaluateUnifiedPlayerCondition(condition: UnifiedPlayerCondition, stats: Record<string, number>): boolean {
  if ("all" in condition) return condition.all.every((part) => evaluateUnifiedPlayerCondition(part, stats));
  if ("any" in condition) return condition.any.some((part) => evaluateUnifiedPlayerCondition(part, stats));
  return evaluateChallengeCondition(condition as ChallengeCondition, stats);
}

const TEAM_LABELS: Partial<Record<TeamStatKey | AggStatKey | StatKey | string, string>> = {
  points_for: "points scored",
  points_against: "points allowed",
  off_yards_gained: "total yards",
  off_rush_yards: "rushing yards",
  off_pass_yards: "passing yards",
  off_first_down: "first downs",
  turnovers_committed: "turnovers",
  generated_turnovers: "takeaways",
  yards_allowed: "yards allowed",
  rush_yards_allowed: "rushing yards allowed",
  pass_yards_allowed: "passing yards allowed",
  first_downs_allowed: "first downs allowed",
  red_zone_off_percentage: "red zone rate",
  red_zone_def_percentage: "opponent red zone rate",
  completion_pct_team: "completion percentage",
  scrimmage_yards: "yards from scrimmage",
  total_tds: "total touchdowns",
  total_tds_player: "touchdowns",
  ypc: "yards per carry",
  ypr: "yards per catch",
  passer_rating: "passer rating",
};

function comparisonPhrase(op: CompareOp, value: number): string {
  if (op === "gte") return `${value}+`;
  if (op === "lte") return `under ${value}`;
  return `fewer than ${value}`;
}

function statLabel(stat: string): string {
  return TEAM_LABELS[stat] ?? stat.replace(/_/g, " ");
}

export function describeUnifiedTeamCondition(condition: WeeklyChallengeCondition): string {
  switch (condition.kind) {
    case "team": return `${comparisonPhrase(condition.op, condition.value)} ${statLabel(condition.stat)}`;
    case "agg": return `${comparisonPhrase(condition.op, condition.value)} ${statLabel(condition.stat)}`;
    case "agg_opponent": return `hold the opponent to ${comparisonPhrase(condition.op, condition.value)} ${statLabel(condition.stat)}`;
    case "agg_eq": return `${statLabel(condition.statA)} matching ${statLabel(condition.statB)}`;
    case "team_margin_turnover": return `win turnover margin by ${comparisonPhrase(condition.op, condition.value)}`;
    case "result": return "win the game";
    case "win_away": return "win on the road";
    case "margin": return `win by ${comparisonPhrase(condition.op, condition.value)} points`;
    case "role": return `${condition.position.toLowerCase()}: ${comparisonPhrase(condition.op, condition.value)} ${statLabel(condition.stat)}`;
    case "all": return condition.parts.map(describeUnifiedTeamCondition).join(" and ");
    default: return "";
  }
}

export function describeUnifiedPlayerCondition(condition: UnifiedPlayerCondition): string {
  if ("all" in condition) return condition.all.map(describeUnifiedPlayerCondition).join(" and ");
  if ("any" in condition) return condition.any.map(describeUnifiedPlayerCondition).join(" or ");
  return `${comparisonPhrase(condition.op, condition.value)} ${statLabel(condition.stat)}`;
}

export function highestCompleteTier(results: UnifiedTierResult[]): WeeklyChallengeTier | null {
  return results.find((row) => row.tier === "gold" && row.complete)?.tier
    ?? results.find((row) => row.tier === "silver" && row.complete)?.tier
    ?? results.find((row) => row.tier === "bronze" && row.complete)?.tier
    ?? null;
}
