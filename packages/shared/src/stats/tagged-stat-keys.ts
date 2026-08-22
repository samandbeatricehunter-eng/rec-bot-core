// Box-score allocations and manual player-stat submissions store a smaller, label-driven
// key set (completions / attempts / yards / touchdowns) instead of EA's canonical names.
// Map those lines onto STAT_DEFINITIONS keys so Stats / Records / QBR can read every
// league data mode through the same counters.

import { canonicalizeStatKey } from "./stat-definitions.js";

const LABEL_TO_CANONICAL: Array<[needle: string, key: string]> = [
  ["passing yards", "pass_yards"],
  ["pass yards", "pass_yards"],
  ["passing touchdowns", "pass_tds"],
  ["passing tds", "pass_tds"],
  ["rushing yards", "rush_yards"],
  ["rush yards", "rush_yards"],
  ["rushing touchdowns", "rush_tds"],
  ["receiving yards", "receiving_yards"],
  ["receiving touchdowns", "receiving_tds"],
  ["interception thrown", "interceptions_thrown"],
  ["interception made", "interceptions"],
  ["forced fumble", "forced_fumbles"],
  ["fumble lost", "rushing_fumbles"],
  ["fumble recover", "fumble_recoveries"],
  ["yards after catch", "rec_yards_after_catch"],
  ["longest rush", "rush_long"],
  ["longest reception", "receiving_long"],
  ["longest pass", "pass_long"],
  ["longest field goal", "fg_long"],
  ["solo tackles", "solo_tackles"],
  ["pass deflection", "pass_deflections"],
];

const KEY_TO_CANONICAL: Record<string, string> = {
  completions: "pass_completions",
  comp: "pass_completions",
  attempts: "pass_attempts",
  att: "pass_attempts",
  carries: "rush_attempts",
  interceptions_thrown: "interceptions_thrown",
  interceptions_made: "interceptions",
  forced_fumble: "forced_fumbles",
  fumbles_lost: "rushing_fumbles",
  fumbles: "rushing_fumbles",
  receptions: "receptions",
  drops: "receiving_drops",
  yac: "rec_yards_after_catch",
  passer_rating: "passer_rating",
  passerrating: "passer_rating",
  qbrating: "passer_rating",
};

/**
 * Resolve one box-score / manual stat line to a canonical key.
 * `siblingKeys` disambiguates generic names like "yards" or "interceptions"
 * using the other keys on the same tag/submission line.
 */
export function canonicalKeyForTaggedStat(
  statKey: string | null | undefined,
  label: string | null | undefined,
  siblingKeys: readonly string[] = [],
): string | null {
  const sk = (statKey ?? "").trim().toLowerCase();
  const lbl = (label ?? "").trim().toLowerCase();
  if (!sk && !lbl) return null;

  for (const [needle, key] of LABEL_TO_CANONICAL) {
    if (lbl.includes(needle)) return key;
  }

  if (KEY_TO_CANONICAL[sk]) return KEY_TO_CANONICAL[sk];

  const siblings = new Set(siblingKeys.map((key) => key.trim().toLowerCase()));
  const passingContext = siblings.has("completions") || siblings.has("attempts") || siblings.has("pass_attempts") || siblings.has("pass_completions");
  const rushingContext = siblings.has("carries") || siblings.has("rush_attempts");
  const receivingContext = siblings.has("receptions") || siblings.has("targets");

  if (sk === "yards" || sk === "touchdowns" || sk === "tds" || sk === "longest") {
    if (passingContext || lbl.includes("pass")) {
      if (sk === "yards") return "pass_yards";
      if (sk === "longest") return "pass_long";
      return "pass_tds";
    }
    if (rushingContext || lbl.includes("rush")) {
      if (sk === "yards") return "rush_yards";
      if (sk === "longest") return "rush_long";
      return "rush_tds";
    }
    if (receivingContext || lbl.includes("rec")) {
      if (sk === "yards") return "receiving_yards";
      if (sk === "longest") return "receiving_long";
      return "receiving_tds";
    }
  }

  if (sk === "interceptions") {
    return passingContext || lbl.includes("thrown") ? "interceptions_thrown" : "interceptions";
  }

  const canonical = canonicalizeStatKey(sk);
  return canonical || null;
}

/** Fold box-score / manual counting keys into canonical names when a bag was stored raw. */
export function coerceSourceStatBag(stats: Record<string, number>): Record<string, number> {
  const keys = Object.keys(stats);
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const canonical = canonicalKeyForTaggedStat(key, "", keys) ?? canonicalizeStatKey(key);
    next[canonical] = (next[canonical] ?? 0) + Number(value);
  }
  return next;
}
