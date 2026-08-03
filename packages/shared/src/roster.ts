// CFB roster position groups, in the standard offense -> defense -> special-teams order used
// by the Team Roster viewer's group selector and position-grade card grid. Matches the actual
// position codes CFB baseline data uses (LEDG/REDG, not "LEDGE"/"REDGE"; WILL/MIKE/SAM for LB).
export const CFB_POSITION_GROUPS = [
  "QB", "HB", "FB", "TE", "WR",
  "LT", "LG", "C", "RG", "RT",
  "LEDG", "REDG", "DT", "WILL", "MIKE", "SAM",
  "CB", "FS", "SS",
  "K", "P",
] as const;
export type CfbPositionGroup = (typeof CFB_POSITION_GROUPS)[number];

// The baseline dataset carries handedness on QBs ("QB (Left)"/"QB (Right)") — collapse both
// onto the QB group for grading/filtering while the raw label still displays per-player.
export function normalizeCfbPosition(rawPosition: string): string {
  return rawPosition.replace(/\s*\((left|right)\)\s*$/i, "").trim().toUpperCase();
}

const GRADE_BANDS: Array<{ min: number; grade: string }> = [
  { min: 90, grade: "A+" },
  { min: 85, grade: "A" },
  { min: 80, grade: "A-" },
  { min: 75, grade: "B+" },
  { min: 70, grade: "B" },
  { min: 65, grade: "B-" },
  { min: 60, grade: "C+" },
  { min: 55, grade: "C" },
  { min: 50, grade: "C-" },
  { min: 45, grade: "D+" },
  { min: 40, grade: "D" },
];

/** Simple band-based letter grade for a position group's average overall. */
export function overallToGrade(avgOverall: number | null): string {
  if (avgOverall == null) return "—";
  for (const band of GRADE_BANDS) {
    if (avgOverall >= band.min) return band.grade;
  }
  return "D-";
}
