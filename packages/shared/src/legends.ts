// Legend catalog browsing: groups each legend's individual `position` into the dropdown
// buckets the Store UI shows (QB, HB, FB, WR, TE, OLine, DLine, LB, Secondary), and lists
// which of the legend's raw attribute keys are relevant to that bucket — used to pick a
// player's "top 3" from the attributes that actually matter for their position, not
// whatever 3 happen to be numerically highest overall.

export const REC_LEGEND_POSITION_GROUPS = ["QB", "HB", "FB", "WR", "TE", "OLine", "DLine", "LB", "Secondary", "K/P"] as const;
export type RecLegendPositionGroup = (typeof REC_LEGEND_POSITION_GROUPS)[number];

// rec_legend_catalog.position is already stored as one of these 9 coarse codes (not the
// finer per-slot abbreviations used elsewhere in the app for scheduled rosters) — this map
// is mostly a rename, with a few finer-grained aliases kept in case catalog data is ever
// entered at that granularity instead.
const POSITION_TO_GROUP: Record<string, RecLegendPositionGroup> = {
  QB: "QB",
  HB: "HB", RB: "HB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  OL: "OLine", LT: "OLine", LG: "OLine", C: "OLine", RG: "OLine", RT: "OLine", G: "OLine", T: "OLine", OT: "OLine", OG: "OLine",
  DL: "DLine", LE: "DLine", RE: "DLine", DT: "DLine", DE: "DLine",
  // LEDG/REDG are the actual CFB roster/baseline-data position codes for edge (vs. the
  // LE/RE used by the legend catalog and custom-player position list) — same DLine group.
  LEDG: "DLine", REDG: "DLine",
  LB: "LB", LOLB: "LB", MLB: "LB", ROLB: "LB", OLB: "LB", ILB: "LB",
  // WILL/MIKE/SAM are the CFB roster's real linebacker slot codes (weak/middle/strong side) —
  // scheme-relative, not directly left/right like LOLB/ROLB, but the same LB group for
  // replacement-eligibility purposes.
  WILL: "LB", MIKE: "LB", SAM: "LB",
  DB: "Secondary", CB: "Secondary", FS: "Secondary", SS: "Secondary", S: "Secondary",
  K: "K/P", P: "K/P",
};

export function legendPositionGroupFor(position: string | null | undefined): RecLegendPositionGroup | null {
  if (!position) return null;
  return POSITION_TO_GROUP[position.trim().toUpperCase()] ?? null;
}

// Raw attribute keys (as stored in rec_legend_catalog.attributes) relevant to each group —
// the pool a legend's "top 3" is chosen from, not the player's 3 highest attributes overall.
export const REC_LEGEND_RELEVANT_ATTRIBUTES: Record<RecLegendPositionGroup, string[]> = {
  QB: ["Throwing Power", "Short Accuracy", "Medium Accuracy", "Deep Accuracy", "Play Action", "Throw on the Run", "Throw Under Pressure", "Awareness", "Break Sack"],
  HB: ["Speed", "Acceleration", "Agility", "Break Tackle", "Trucking", "Juke Move", "Spin Move", "Stiff Arm", "Carrying", "BC Vision", "Change of Direction"],
  FB: ["Run Blocking", "Impact Blocking", "Lead Block", "Trucking", "Strength", "Carrying", "Run Block Power"],
  WR: ["Speed", "Acceleration", "Catching", "Spectacular Catch", "Catch in Traffic", "Short Route Running", "Medium Route Running", "Deep Route Running", "Release", "Jumping"],
  TE: ["Catching", "Run Blocking", "Pass Blocking", "Short Route Running", "Medium Route Running", "Strength", "Speed", "Catch in Traffic"],
  OLine: ["Run Blocking", "Pass Blocking", "Run Block Power", "Pass Block Power", "Run Block Finesse", "Pass Block Finesse", "Impact Blocking", "Strength"],
  DLine: ["Block Shedding", "Power Moves", "Finesse Moves", "Pursuit", "Tackling", "Strength"],
  LB: ["Tackling", "Pursuit", "Play Recognition", "Man Coverage", "Zone Coverage", "Hit Power", "Block Shedding"],
  Secondary: ["Man Coverage", "Zone Coverage", "Press", "Speed", "Agility", "Play Recognition"],
  "K/P": ["Kicking Power", "Kicking Accuracy", "Awareness"],
};

export function legendTopAttributes(
  attributes: Record<string, number> | null | undefined,
  group: RecLegendPositionGroup | null,
  count = 3,
): Array<{ key: string; value: number }> {
  if (!attributes || !group) return [];
  const pool = REC_LEGEND_RELEVANT_ATTRIBUTES[group] ?? [];
  return pool
    .map((key) => ({ key, value: Number(attributes[key] ?? 0) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}
