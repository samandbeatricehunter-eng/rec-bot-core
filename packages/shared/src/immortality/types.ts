export const RISE_TO_IMMORTALITY_LEAGUE_TYPE = "rise_to_immortality" as const;
export const RISE_TO_IMMORTALITY_TEMPLATE_ID = "rise_to_immortality" as const;
export const RISE_TO_IMMORTALITY_GAME = "madden_27" as const;

export const IMMORTALITY_CHAPTERS = [
  "ORIGINS",
  "DRAFT_NIGHT_ROOKIES",
  "DRAFT_NIGHT_TEAMS",
  "THE_LEAGUE",
  "IMMORTALITY",
] as const;
export type ImmortalityChapter = (typeof IMMORTALITY_CHAPTERS)[number];

export const IMMORTALITY_STATES = [
  "SETUP",
  "REGISTRATION",
  "ORIGINS",
  "ORIGINS_COMPLETE",
  "ROOKIE_DRAFT_PREP",
  "ROOKIE_DRAFT_LIVE",
  "ROOKIE_DRAFT_COMPLETE",
  "TEAM_DRAFT",
  "FRANCHISE_ACTIVE",
  "OFFSEASON",
  "IMMORTALITY_PREP",
  "IMMORTALITY_VOTING",
  "IMMORTALITY_REVEAL",
  "ARCHIVED",
] as const;
export type ImmortalityState = (typeof IMMORTALITY_STATES)[number];

export const IMMORTALITY_OFFENSE_POSITIONS = ["QB", "HB", "WR", "TE"] as const;
export type ImmortalityOffensePosition = (typeof IMMORTALITY_OFFENSE_POSITIONS)[number];

export const IMMORTALITY_DEFENSE_POSITIONS = ["CB", "FS", "SS", "MIKE"] as const;
export type ImmortalityDefensePosition = (typeof IMMORTALITY_DEFENSE_POSITIONS)[number];

export type ImmortalityPosition = ImmortalityOffensePosition | ImmortalityDefensePosition;
export type ImmortalitySide = "offense" | "defense";

export const IMMORTALITY_POSITION_GROUPS = ["QB", "HB", "WR_TE", "DB", "LB"] as const;
export type ImmortalityPositionGroup = (typeof IMMORTALITY_POSITION_GROUPS)[number];

export const PERSONA_DIMENSIONS = [
  "Leadership",
  "Competitive Fire",
  "Team First",
  "Showmanship",
  "Composure",
  "Legacy Drive",
] as const;
export type PersonaDimension = (typeof PERSONA_DIMENSIONS)[number];

export const DEV_TRAITS = ["normal", "star", "superstar", "xfactor"] as const;
export type ImmortalityDevTrait = (typeof DEV_TRAITS)[number];

export const FORMULA_VERSIONS = {
  iq: "immortality-iq-v1",
  persona: "immortality-persona-v1",
  playstyle: "immortality-playstyle-v1",
  baseline: "immortality-baseline-m27-68-72-v1",
  creationPoints: "immortality-cp-v1",
  characteristics: "immortality-characteristics-v1",
  draft: "immortality-draft-v1",
  xp: "immortality-xp-v1",
  contracts: "immortality-contracts-v1",
  careerScore: "immortality-career-score-v1",
  abilities: "immortality-abilities-m27-v1",
} as const;

export type AttributeCode = string;
export type AttributeMap = Record<AttributeCode, number>;

export function positionGroupFor(position: ImmortalityPosition): ImmortalityPositionGroup {
  if (position === "QB") return "QB";
  if (position === "HB") return "HB";
  if (position === "WR" || position === "TE") return "WR_TE";
  if (position === "CB" || position === "FS" || position === "SS") return "DB";
  return "LB";
}

export function sideForPosition(position: ImmortalityPosition): ImmortalitySide {
  return IMMORTALITY_OFFENSE_POSITIONS.includes(position as ImmortalityOffensePosition) ? "offense" : "defense";
}

/** Madden OVR calculator uses MLB for the MIKE linebacker slot. */
export function ovrPositionFor(position: ImmortalityPosition): string {
  return position === "MIKE" ? "MLB" : position;
}

export function isImmortalityOffensePosition(value: string): value is ImmortalityOffensePosition {
  return (IMMORTALITY_OFFENSE_POSITIONS as readonly string[]).includes(value);
}

export function isImmortalityDefensePosition(value: string): value is ImmortalityDefensePosition {
  return (IMMORTALITY_DEFENSE_POSITIONS as readonly string[]).includes(value);
}

export function isRiseToImmortalityLeagueType(value: string | null | undefined): boolean {
  return value === RISE_TO_IMMORTALITY_LEAGUE_TYPE;
}

export function isRiseToImmortalityTemplateId(value: string | null | undefined): boolean {
  return value === RISE_TO_IMMORTALITY_TEMPLATE_ID;
}
