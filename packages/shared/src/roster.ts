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

// Madden baseline data was imported using the same position-code scheme as CFB (LEDG/REDG,
// WILL/MIKE/SAM), so it reuses the same group list plus long snapper, which CFB doesn't track.
export const MADDEN_POSITION_GROUPS = [...CFB_POSITION_GROUPS, "LS"] as const;
export type MaddenPositionGroup = (typeof MADDEN_POSITION_GROUPS)[number];

// The baseline dataset carries handedness on QBs ("QB (Left)"/"QB (Right)") — collapse both
// onto the QB group for grading/filtering while the raw label still displays per-player.
export function normalizeCfbPosition(rawPosition: string): string {
  return rawPosition.replace(/\s*\((left|right)\)\s*$/i, "").trim().toUpperCase();
}

// The legend catalog and the custom-player position picker use LE/RE/LOLB/MLB/ROLB — the
// actual CFB roster/baseline data uses LEDG/REDG/WILL/MIKE/SAM for the same real positions
// (edge and outside/middle linebacker respectively). Everywhere else (QB, CB, FS, SS, etc.)
// the two schemes already agree, so only these need an explicit alias — a plain position
// group merge would incorrectly treat CB/FS/SS as interchangeable, which they're not.
const POSITION_ALIASES: Record<string, string[]> = {
  LE: ["LE", "LEDG"], RE: ["RE", "REDG"],
  LOLB: ["LOLB", "WILL"], MLB: ["MLB", "MIKE"], ROLB: ["ROLB", "SAM"],
};

/** Whether a roster player's position is eligible to be replaced by a legend/custom-player
 * build targeting `targetPosition` — exact match, except for the LE/RE and LB slots where
 * the roster data and the builder's position list use different position codes. */
export function isCompatibleReplacementPosition(targetPosition: string | null | undefined, rosterPosition: string | null | undefined): boolean {
  if (!targetPosition || !rosterPosition) return false;
  const target = targetPosition.trim().toUpperCase();
  const roster = rosterPosition.trim().toUpperCase();
  const aliases = POSITION_ALIASES[target];
  return aliases ? aliases.includes(roster) : target === roster;
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
