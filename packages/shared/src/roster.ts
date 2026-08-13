// CFB roster position groups, in the standard offense -> defense -> special-teams order used
// by the Team Roster viewer's group selector and position-grade card grid. Display uses
// LEDGE/REDGE; normalizeCfbPosition maps LEDG/LE and REDG/RE onto those labels.
export const CFB_POSITION_GROUPS = [
  "QB", "HB", "FB", "WR", "TE",
  "LT", "LG", "C", "RG", "RT",
  "LEDGE", "REDGE", "DT", "WILL", "MIKE", "SAM",
  "CB", "FS", "SS",
  "K", "P",
] as const;
export type CfbPositionGroup = (typeof CFB_POSITION_GROUPS)[number];

// Madden baseline data was imported using the same position-code scheme as CFB (LEDG/REDG,
// WILL/MIKE/SAM), so it reuses the same group list plus long snapper, which CFB doesn't track.
export const MADDEN_POSITION_GROUPS = [...CFB_POSITION_GROUPS, "LS"] as const;
export type MaddenPositionGroup = (typeof MADDEN_POSITION_GROUPS)[number];

/** Store / roster picker chip order (horizontal). Display labels; matching accepts aliases. */
export const REC_ROSTER_POSITION_FILTERS = [
  "QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT",
  "LEDGE", "REDGE", "DT", "WILL", "MIKE", "SAM", "CB", "FS", "SS", "K", "P",
] as const;
export type RecRosterPositionFilter = (typeof REC_ROSTER_POSITION_FILTERS)[number];

const ROSTER_POSITION_FILTER_ALIASES: Record<string, readonly string[]> = {
  QB: ["QB"],
  HB: ["HB", "RB"],
  FB: ["FB"],
  WR: ["WR"],
  TE: ["TE"],
  LT: ["LT"],
  LG: ["LG"],
  C: ["C"],
  RG: ["RG"],
  RT: ["RT"],
  LEDGE: ["LEDGE", "LEDG", "LE"],
  REDGE: ["REDGE", "REDG", "RE"],
  DT: ["DT", "NT"],
  // Match isCompatibleReplacementPosition aliases (LOLB↔WILL, ROLB↔SAM).
  WILL: ["WILL", "LOLB"],
  MIKE: ["MIKE", "MLB"],
  SAM: ["SAM", "ROLB"],
  CB: ["CB"],
  FS: ["FS"],
  SS: ["SS"],
  K: ["K"],
  P: ["P"],
};

/** True when a player's stored position code belongs under the given filter chip. */
export function matchesRosterPositionFilter(playerPosition: string | null | undefined, filter: string): boolean {
  if (!playerPosition || !filter || filter === "ALL") return true;
  const pos = normalizeCfbPosition(playerPosition);
  const aliases = ROSTER_POSITION_FILTER_ALIASES[filter.toUpperCase()] ?? [filter.toUpperCase()];
  return aliases.includes(pos);
}

// The baseline dataset carries handedness on QBs ("QB (Left)"/"QB (Right)") — collapse both
// onto the QB group for grading/filtering while the raw label still displays per-player.
export function normalizeCfbPosition(rawPosition: string): string {
  const cleaned = rawPosition.replace(/\s*\((left|right)\)\s*$/i, "").trim().toUpperCase();
  if (cleaned === "LEDG" || cleaned === "LE") return "LEDGE";
  if (cleaned === "REDG" || cleaned === "RE") return "REDGE";
  if (cleaned === "RB") return "HB";
  return cleaned;
}

// The legend catalog and the custom-player position picker use LE/RE/LOLB/MLB/ROLB — actual
// CFB roster data uses LEDG/REDG (and inconsistently LEDGE/REDGE — both spellings exist
// across different import sources) plus WILL/MIKE/SAM for the same real positions (edge and
// outside/middle linebacker respectively). Everywhere else (QB, CB, FS, SS, etc.) the two
// schemes already agree, so only these need an explicit alias — a plain position group merge
// would incorrectly treat CB/FS/SS as interchangeable, which they're not.
const POSITION_ALIASES: Record<string, string[]> = {
  LE: ["LE", "LEDG", "LEDGE"], RE: ["RE", "REDG", "REDGE"],
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

const CANONICAL_POSITION_BY_ROSTER_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(POSITION_ALIASES).flatMap(([canonical, variants]) => variants.map((variant) => [variant, canonical])),
);

/** Maps a roster player's raw position code (which may be a CFB-only variant like SAM/WILL/
 * MIKE/LEDGE/REDGE) to the canonical code the legend/custom-player position lists and
 * archetype catalogs are keyed by (LOLB/MLB/ROLB/LE/RE). Positions that already agree between
 * the two schemes (QB, CB, FS, SS, etc.) pass through unchanged. */
export function canonicalReplacementPosition(rosterPosition: string | null | undefined): string {
  if (!rosterPosition) return "";
  const roster = rosterPosition.trim().toUpperCase();
  return CANONICAL_POSITION_BY_ROSTER_CODE[roster] ?? roster;
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
