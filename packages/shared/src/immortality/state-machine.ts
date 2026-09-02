import { IMMORTALITY_STATES, type ImmortalityChapter, type ImmortalityState } from "./types.js";

const STATE_SET = new Set<string>(IMMORTALITY_STATES);

const TRANSITIONS: Record<ImmortalityState, readonly ImmortalityState[]> = {
  SETUP: ["REGISTRATION"],
  REGISTRATION: ["ORIGINS"],
  ORIGINS: ["ORIGINS_COMPLETE"],
  ORIGINS_COMPLETE: ["ROOKIE_DRAFT_PREP", "ROOKIE_DRAFT_COMPLETE"],
  ROOKIE_DRAFT_PREP: ["ROOKIE_DRAFT_LIVE", "ROOKIE_DRAFT_COMPLETE"],
  ROOKIE_DRAFT_LIVE: ["ROOKIE_DRAFT_COMPLETE"],
  ROOKIE_DRAFT_COMPLETE: ["TEAM_DRAFT"],
  TEAM_DRAFT: ["FRANCHISE_ACTIVE"],
  FRANCHISE_ACTIVE: ["OFFSEASON", "IMMORTALITY_PREP"],
  OFFSEASON: ["FRANCHISE_ACTIVE", "IMMORTALITY_PREP"],
  IMMORTALITY_PREP: ["IMMORTALITY_VOTING"],
  IMMORTALITY_VOTING: ["IMMORTALITY_REVEAL"],
  IMMORTALITY_REVEAL: ["ARCHIVED"],
  ARCHIVED: [],
};

const CHAPTER_FOR_STATE: Record<ImmortalityState, ImmortalityChapter> = {
  SETUP: "ORIGINS",
  REGISTRATION: "ORIGINS",
  ORIGINS: "ORIGINS",
  ORIGINS_COMPLETE: "ORIGINS",
  ROOKIE_DRAFT_PREP: "DRAFT_NIGHT_ROOKIES",
  ROOKIE_DRAFT_LIVE: "DRAFT_NIGHT_ROOKIES",
  ROOKIE_DRAFT_COMPLETE: "DRAFT_NIGHT_ROOKIES",
  TEAM_DRAFT: "DRAFT_NIGHT_TEAMS",
  FRANCHISE_ACTIVE: "THE_LEAGUE",
  OFFSEASON: "THE_LEAGUE",
  IMMORTALITY_PREP: "IMMORTALITY",
  IMMORTALITY_VOTING: "IMMORTALITY",
  IMMORTALITY_REVEAL: "IMMORTALITY",
  ARCHIVED: "IMMORTALITY",
};

export function isImmortalityState(value: string): value is ImmortalityState {
  return STATE_SET.has(value);
}

export function chapterForState(state: ImmortalityState): ImmortalityChapter {
  return CHAPTER_FOR_STATE[state];
}

export function allowedNextStates(from: ImmortalityState): readonly ImmortalityState[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ImmortalityState, to: ImmortalityState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ImmortalityState, to: ImmortalityState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Rise to Immortality cannot move from ${from} to ${to}.`);
  }
}

export function originsOpen(state: ImmortalityState): boolean {
  // upsertProspectIdentity already special-cases REGISTRATION as open (nothing gates the
  // rest of the Origins flow on chapter state at all) -- there is no meaningful manual
  // "Open ORIGINS" step, so this informational flag should agree with that from day one.
  return state === "ORIGINS" || state === "REGISTRATION";
}

export function draftDestinationHidden(state: ImmortalityState): boolean {
  return state !== "ROOKIE_DRAFT_LIVE"
    && state !== "ROOKIE_DRAFT_COMPLETE"
    && state !== "TEAM_DRAFT"
    && state !== "FRANCHISE_ACTIVE"
    && state !== "OFFSEASON"
    && state !== "IMMORTALITY_PREP"
    && state !== "IMMORTALITY_VOTING"
    && state !== "IMMORTALITY_REVEAL"
    && state !== "ARCHIVED";
}

export function franchisePlayOpen(state: ImmortalityState): boolean {
  return state === "FRANCHISE_ACTIVE" || state === "OFFSEASON";
}

export function hallVotingOpen(state: ImmortalityState): boolean {
  return state === "IMMORTALITY_VOTING";
}

/** Full league hub (matchups, My Team, schedule) after the virtual rookie draft assigns franchises. */
export function riseHubUnlocked(state: ImmortalityState): boolean {
  return state === "ROOKIE_DRAFT_COMPLETE"
    || state === "TEAM_DRAFT"
    || state === "FRANCHISE_ACTIVE"
    || state === "OFFSEASON"
    || state === "IMMORTALITY_PREP"
    || state === "IMMORTALITY_VOTING"
    || state === "IMMORTALITY_REVEAL"
    || state === "ARCHIVED";
}
