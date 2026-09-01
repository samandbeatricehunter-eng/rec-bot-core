/**
 * Real-world all-time NFL career record marks, seeded into RTI leagues as the bar a
 * prospect must clear to trigger a "sets an NFL record" breakout-game dev-trait
 * promotion opportunity. Tackle numbers per user-provided source (Ray Lewis, career
 * combined/solo); the rest are the commonly cited all-time career leaders as of this
 * writing. These are reference thresholds for gameplay, not a legal record of fact.
 */
export type NflRecordCategory =
  | "pass_yards"
  | "pass_tds"
  | "rush_yards"
  | "rush_tds"
  | "receptions"
  | "receiving_yards"
  | "receiving_tds"
  | "tackles_combined"
  | "tackles_solo"
  | "interceptions"
  | "sacks";

export type NflRecordEntry = {
  category: NflRecordCategory;
  label: string;
  holder: string;
  value: number;
  appliesToPositionGroups: Array<"QB" | "HB" | "WR_TE" | "DB" | "LB">;
};

export const NFL_CAREER_RECORDS: Record<NflRecordCategory, NflRecordEntry> = {
  pass_yards: { category: "pass_yards", label: "Career passing yards", holder: "Tom Brady", value: 89214, appliesToPositionGroups: ["QB"] },
  pass_tds: { category: "pass_tds", label: "Career passing touchdowns", holder: "Tom Brady", value: 649, appliesToPositionGroups: ["QB"] },
  rush_yards: { category: "rush_yards", label: "Career rushing yards", holder: "Emmitt Smith", value: 18355, appliesToPositionGroups: ["HB", "QB"] },
  rush_tds: { category: "rush_tds", label: "Career rushing touchdowns", holder: "Emmitt Smith", value: 175, appliesToPositionGroups: ["HB", "QB"] },
  receptions: { category: "receptions", label: "Career receptions", holder: "Jerry Rice", value: 1549, appliesToPositionGroups: ["WR_TE", "HB"] },
  receiving_yards: { category: "receiving_yards", label: "Career receiving yards", holder: "Jerry Rice", value: 22895, appliesToPositionGroups: ["WR_TE", "HB"] },
  receiving_tds: { category: "receiving_tds", label: "Career receiving touchdowns", holder: "Jerry Rice", value: 197, appliesToPositionGroups: ["WR_TE", "HB"] },
  tackles_combined: { category: "tackles_combined", label: "Career combined tackles", holder: "Ray Lewis", value: 2059, appliesToPositionGroups: ["LB", "DB"] },
  tackles_solo: { category: "tackles_solo", label: "Career solo tackles", holder: "Ray Lewis", value: 1568, appliesToPositionGroups: ["LB", "DB"] },
  interceptions: { category: "interceptions", label: "Career interceptions", holder: "Paul Krause", value: 81, appliesToPositionGroups: ["DB", "LB"] },
  sacks: { category: "sacks", label: "Career sacks", holder: "Bruce Smith", value: 200, appliesToPositionGroups: ["LB", "DB"] },
};

export function recordCategoriesForPositionGroup(group: "QB" | "HB" | "WR_TE" | "DB" | "LB"): NflRecordEntry[] {
  return Object.values(NFL_CAREER_RECORDS).filter((entry) => entry.appliesToPositionGroups.includes(group));
}

/** True once a prospect's career total in this category has passed the seeded all-time mark. */
export function isCareerRecordBroken(category: NflRecordCategory, careerTotal: number): boolean {
  return careerTotal > NFL_CAREER_RECORDS[category].value;
}
