// ─────────────────────────────────────────────────────────────────────────────
// Stat normalizer — converts raw Madden/EA import JSON into canonical REC stat
// keys before storage and calculation. Never throws on unknown keys; unknown
// keys are surfaced via unmappedStats for admin/debug.
// ─────────────────────────────────────────────────────────────────────────────

import {
  STAT_DEFINITIONS,
  PLAYER_IDENTITY_ALIASES,
  TEAM_IDENTITY_ALIASES,
  type StatDefinition,
  type StatScope
} from "./stat-definitions.js";

export type StatScalar = number | string | boolean | null;

export interface NormalizeInput {
  scope: StatScope;
  statCategory?: string | null;
  stats?: Record<string, unknown> | null;
  rawPayload?: Record<string, unknown> | null;
}

export interface NormalizeResult {
  canonicalStats: Record<string, StatScalar>;
  rawAliasesUsed: Record<string, string>;
  unmappedStats: Record<string, unknown>;
  statCategory: string;
}

// Collapse a key to a comparison form: lower-case, strip non-alphanumerics.
// This makes pass_yards, passYards, and "Pass Yards" all equal -> "passyards".
function normKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Indexes (built once at module load) ───────────────────────────────────────

export const DEF_BY_KEY = new Map<string, StatDefinition>(
  STAT_DEFINITIONS.map((def) => [def.canonicalKey, def])
);

// Ambiguous aliases are resolved by scope + statCategory rather than a flat index.
const AMBIGUOUS_ALIASES = new Set<string>(
  [
    "interceptions", "ints", "int", "picks", "defints",
    "sacks", "sack", "defsacks",
    "passyards", "passingyards", "passyds", "passingyds",
    "rushyards", "rushingyards", "rushyds", "rushingyds",
    "points", "score"
  ].map(normKey)
);

// Flat index: normalized canonicalKey/alias -> canonicalKey, excluding ambiguous.
const FLAT_INDEX = new Map<string, string>();
for (const def of STAT_DEFINITIONS) {
  const ck = normKey(def.canonicalKey);
  if (!AMBIGUOUS_ALIASES.has(ck) && !FLAT_INDEX.has(ck)) FLAT_INDEX.set(ck, def.canonicalKey);
  for (const alias of def.aliases) {
    const na = normKey(alias);
    if (AMBIGUOUS_ALIASES.has(na)) continue;
    if (!FLAT_INDEX.has(na)) FLAT_INDEX.set(na, def.canonicalKey);
  }
}

// Identity keys (normalized) — these are NOT stats and are skipped during normalization.
const IDENTITY_KEYS = new Set<string>(
  [...Object.keys(PLAYER_IDENTITY_ALIASES), ...Object.keys(TEAM_IDENTITY_ALIASES)].map(normKey)
);

// ── Context-sensitive resolution ──────────────────────────────────────────────

function resolveAmbiguous(norm: string, scope: StatScope, cat: string): string | null {
  const isPassing = cat.includes("passing") || cat.includes("pass");
  const isDefense = cat.includes("defense") || cat.includes("def");

  if (["interceptions", "ints", "int", "picks", "defints"].includes(norm)) {
    if (scope === "team") return "team_interceptions";
    if (scope === "player" && isPassing && !isDefense) return "interceptions_thrown";
    if (scope === "player") return "interceptions";
    return null;
  }
  if (["sacks", "sack", "defsacks"].includes(norm)) {
    if (scope === "team") return "team_sacks";
    if (scope === "player" && isPassing && !isDefense) return "sacks_taken";
    if (scope === "player") return "sacks";
    return null;
  }
  if (["passyards", "passingyards", "passyds", "passingyds"].includes(norm)) {
    if (scope === "team") return "team_pass_yards";
    return "pass_yards";
  }
  if (["rushyards", "rushingyards", "rushyds", "rushingyds"].includes(norm)) {
    if (scope === "team") return "team_rush_yards";
    return "rush_yards";
  }
  if (["points", "score"].includes(norm)) {
    if (scope === "game") return null; // game scope only maps explicit home/away score keys
    if (scope === "team") return "points_for";
    return null;
  }
  return null;
}

// Resolve a single raw key to a canonical stat key (or null if unmapped).
export function resolveCanonicalKey(rawKey: string, scope: StatScope, statCategory?: string | null): string | null {
  const norm = normKey(rawKey);
  const cat = (statCategory ?? "").toLowerCase();
  if (AMBIGUOUS_ALIASES.has(norm)) return resolveAmbiguous(norm, scope, cat);
  return FLAT_INDEX.get(norm) ?? null;
}

// ── Scalar coercion ───────────────────────────────────────────────────────────

function coerceScalar(value: unknown): StatScalar | undefined {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    // Numeric-looking strings become numbers
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
  // objects / arrays / functions are not scalar stats
  return undefined;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function normalizeImportedStats(input: NormalizeInput): NormalizeResult {
  const scope = input.scope;
  const statCategory = input.statCategory ?? "general";
  const canonicalStats: Record<string, StatScalar> = {};
  const rawAliasesUsed: Record<string, string> = {};
  const unmappedStats: Record<string, unknown> = {};

  // Merge raw payload first, then stats override (stats preferred when both present).
  const merged: Record<string, unknown> = {
    ...(input.rawPayload ?? {}),
    ...(input.stats ?? {})
  };

  for (const [rawKey, rawVal] of Object.entries(merged)) {
    const norm = normKey(rawKey);
    if (IDENTITY_KEYS.has(norm)) continue; // identity field, not a stat

    const val = coerceScalar(rawVal);
    if (val === undefined) continue; // nested / non-scalar — ignore for stats

    const canonical = resolveCanonicalKey(rawKey, scope, statCategory);
    if (canonical) {
      canonicalStats[canonical] = val;
      if (normKey(canonical) !== norm) rawAliasesUsed[rawKey] = canonical;
    } else {
      unmappedStats[rawKey] = rawVal;
    }
  }

  return { canonicalStats, rawAliasesUsed, unmappedStats, statCategory };
}

// ── Backward-compatible read helper ───────────────────────────────────────────
// Reads a canonical stat value out of a stored stats object, tolerating both
// canonical keys (new imports) and raw EA alias keys (legacy imports). Returns a
// number (0 if absent). Use this in payout/award/challenge calculations so they
// reference canonical keys without breaking on already-stored raw data.
export function readStat(stats: Record<string, unknown> | null | undefined, canonicalKey: string): number {
  if (!stats) return 0;
  const def = DEF_BY_KEY.get(canonicalKey);
  const candidates = def ? [def.canonicalKey, ...def.aliases] : [canonicalKey];

  // Build a normalized lookup of the stats object once.
  const normLookup = new Map<string, unknown>();
  for (const [k, v] of Object.entries(stats)) {
    const nk = normKey(k);
    if (!normLookup.has(nk)) normLookup.set(nk, v);
  }

  for (const cand of candidates) {
    const v = normLookup.get(normKey(cand));
    if (v === undefined || v === null) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
