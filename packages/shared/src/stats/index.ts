// ─────────────────────────────────────────────────────────────────────────────
// REC stat system — public surface. Definitions, normalizer, and display helpers.
// ─────────────────────────────────────────────────────────────────────────────

export * from "./stat-definitions.js";
export * from "./stat-normalizer.js";

import {
  STAT_DEFINITIONS,
  type StatDefinition,
  type StatUsage,
  type StatValueType
} from "./stat-definitions.js";
import { DEF_BY_KEY } from "./stat-normalizer.js";

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getStatDefinition(canonicalKey: string): StatDefinition | undefined {
  return DEF_BY_KEY.get(canonicalKey);
}

export function getStatLabel(canonicalKey: string): string {
  return DEF_BY_KEY.get(canonicalKey)?.label ?? canonicalKey;
}

export function getStatShortLabel(canonicalKey: string): string {
  const def = DEF_BY_KEY.get(canonicalKey);
  return def?.shortLabel ?? def?.label ?? canonicalKey;
}

export function getStatsByUsage(usage: StatUsage): StatDefinition[] {
  return STAT_DEFINITIONS.filter((def) => def.usedFor.includes(usage));
}

export function getStatsByCategory(category: string): StatDefinition[] {
  return STAT_DEFINITIONS.filter((def) => def.category === category);
}

// awardKey/payoutKey are accepted for future per-award/per-payout maps; for now
// they return the stat pool flagged for that usage.
export function getStatsForAward(_awardKey?: string): StatDefinition[] {
  return getStatsByUsage("award");
}

export function getStatsForEosPayout(_payoutKey?: string): StatDefinition[] {
  return getStatsByUsage("eos_payout");
}

// ── Formatting ────────────────────────────────────────────────────────────────

function commaInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function commaNumber(value: number, precision: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function formatStatValue(canonicalKey: string, value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const def = DEF_BY_KEY.get(canonicalKey);
  const valueType: StatValueType = def?.valueType ?? "number";

  if (valueType === "boolean") {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return Number(value) > 0 ? "Yes" : "No";
  }

  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);

  switch (valueType) {
    case "yards":
      return `${commaInt(num)} yds`;
    case "points":
      return `${commaInt(num)} pts`;
    case "percentage":
      return `${commaNumber(num, def?.precision ?? 1)}%`;
    case "ratio":
      return commaNumber(num, def?.precision ?? 1);
    case "seconds":
      return formatSeconds(num);
    case "integer":
      return commaInt(num);
    case "number":
    default:
      return def?.precision != null ? commaNumber(num, def.precision) : commaInt(num);
  }
}
