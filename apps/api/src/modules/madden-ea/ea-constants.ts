// EA companion-app constants for REC's direct Madden import.
//
// These mirror the values reverse-engineered by snallabot (snallabot/snallabot-service,
// docs/madden/ea_api.md) including its unmerged M27 PR #150, which bumps YEAR to 2027 and
// renames the Blaze RPC component to "franchisemode" while deliberately keeping the M26
// client id / entitlement year. Every value is env-overridable because EA rotates them each
// Madden cycle and PR #150 is not merged upstream, so the M27 values are not yet settled.
//
// CLIENT_SECRET has no default on purpose: it is a credential, so it lives only in env.

import { env } from "../../config/env.js";

export const EA_ACCOUNTS_BASE = "https://accounts.ea.com";
export const EA_GATEWAY_BASE = "https://gateway.ea.com";
export const BLAZE_BASE_URL = env.EA_BLAZE_BASE_URL ?? "https://wal2.tools.gos.bio-iad.ea.com";

export const AUTH_SOURCE = env.EA_AUTH_SOURCE ?? "317239";
export const CLIENT_ID = env.EA_CLIENT_ID ?? "MCA_26_COMP_APP";
export const MACHINE_KEY = env.EA_MACHINE_KEY ?? "444d362e8e067fe2";
export const REDIRECT_URL = env.EA_REDIRECT_URL ?? "http://127.0.0.1/success";

/** Entitlement year. PR #150 keeps this at 26 even for M27 — EA had not rotated the
 *  companion app's entitlement group names at the time. */
export const TWO_DIGIT_YEAR = env.EA_TWO_DIGIT_YEAR ?? "26";
/** Blaze product/service year. PR #150 bumps this to 2027 for M27. */
export const YEAR = env.EA_YEAR ?? "2027";
/** M27 renamed the Blaze RPC component from "careermode" to "franchisemode". */
export const BLAZE_COMPONENT_NAME = env.EA_BLAZE_COMPONENT_NAME ?? "franchisemode";

export const ANDROID_USER_AGENT =
  "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)";

export function eaClientSecret(): string {
  const secret = env.EA_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new Error("EA import is not configured on this server (EA_CLIENT_SECRET is unset).");
  }
  return secret;
}

export function isEaImportConfigured(): boolean {
  return Boolean(env.EA_CLIENT_SECRET?.trim()) && Boolean(env.EA_TOKEN_ENC_KEY?.trim());
}

export const EA_LOGIN_URL =
  `${EA_ACCOUNTS_BASE}/connect/auth?hide_create=true&release_type=prod&response_type=code` +
  `&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}` +
  `&machineProfileKey=${MACHINE_KEY}&authentication_source=${AUTH_SOURCE}`;

export type SystemConsole = "xone" | "ps4" | "pc" | "ps5" | "xbsx" | "stadia";

export const VALID_ENTITLEMENTS: Record<SystemConsole, string> = {
  xone: `MADDEN_${TWO_DIGIT_YEAR}XONE`,
  ps4: `MADDEN_${TWO_DIGIT_YEAR}PS4`,
  pc: `MADDEN_${TWO_DIGIT_YEAR}PC`,
  ps5: `MADDEN_${TWO_DIGIT_YEAR}PS5`,
  xbsx: `MADDEN_${TWO_DIGIT_YEAR}XBSX`,
  stadia: `MADDEN_${TWO_DIGIT_YEAR}SDA`,
};

export const ENTITLEMENT_TO_SYSTEM: Record<string, SystemConsole> = {
  [`MADDEN_${TWO_DIGIT_YEAR}XONE`]: "xone",
  [`MADDEN_${TWO_DIGIT_YEAR}PS4`]: "ps4",
  [`MADDEN_${TWO_DIGIT_YEAR}PC`]: "pc",
  [`MADDEN_${TWO_DIGIT_YEAR}PS5`]: "ps5",
  [`MADDEN_${TWO_DIGIT_YEAR}XBSX`]: "xbsx",
  [`MADDEN_${TWO_DIGIT_YEAR}SDA`]: "stadia",
};

export type EaNamespace = "xbox" | "ps3" | "cem_ea_id" | "stadia";

/** A persona is only valid for an entitlement when its namespaceName matches. */
export const ENTITLEMENT_TO_VALID_NAMESPACE: Record<string, EaNamespace> = {
  [`MADDEN_${TWO_DIGIT_YEAR}XONE`]: "xbox",
  [`MADDEN_${TWO_DIGIT_YEAR}PS4`]: "ps3",
  [`MADDEN_${TWO_DIGIT_YEAR}PC`]: "cem_ea_id",
  [`MADDEN_${TWO_DIGIT_YEAR}PS5`]: "ps3",
  [`MADDEN_${TWO_DIGIT_YEAR}XBSX`]: "xbox",
  [`MADDEN_${TWO_DIGIT_YEAR}SDA`]: "stadia",
};

export const NAMESPACE_LABELS: Record<EaNamespace, string> = {
  xbox: "Xbox",
  ps3: "PlayStation",
  cem_ea_id: "EA Account",
  stadia: "Stadia",
};

export const BLAZE_SERVICE: Record<SystemConsole, string> = {
  xone: `madden-${YEAR}-xone`,
  ps4: `madden-${YEAR}-ps4`,
  pc: `madden-${YEAR}-pc`,
  ps5: `madden-${YEAR}-ps5`,
  xbsx: `madden-${YEAR}-xbsx`,
  stadia: `madden-${YEAR}-stadia`,
};

export const BLAZE_PRODUCT_NAME: Record<SystemConsole, string> = {
  xone: `madden-${YEAR}-xone-mca`,
  ps4: `madden-${YEAR}-ps4-mca`,
  pc: `madden-${YEAR}-pc-mca`,
  ps5: `madden-${YEAR}-ps5-mca`,
  xbsx: `madden-${YEAR}-xbsx-mca`,
  stadia: `madden-${YEAR}-stadia-mca`,
};

/** Which EA export datasets REC can request. Values are the Blaze endpoint names. Upstream
 *  still uses CareerMode_* even in the M27 PR, so those remain the defaults; each is
 *  individually env-overridable in case EA renames them to FranchiseMode_*. */
export const EA_EXPORTS = {
  TEAMS: env.EA_EXPORT_TEAMS ?? "CareerMode_GetLeagueTeamsExport",
  STANDINGS: env.EA_EXPORT_STANDINGS ?? "CareerMode_GetStandingsExport",
  WEEKLY_SCHEDULE: env.EA_EXPORT_WEEKLY_SCHEDULE ?? "CareerMode_GetWeeklySchedulesExport",
  RUSHING_STATS: env.EA_EXPORT_RUSHING_STATS ?? "CareerMode_GetWeeklyRushingStatsExport",
  TEAM_STATS: env.EA_EXPORT_TEAM_STATS ?? "CareerMode_GetWeeklyTeamStatsExport",
  PUNTING_STATS: env.EA_EXPORT_PUNTING_STATS ?? "CareerMode_GetWeeklyPuntingStatsExport",
  RECEIVING_STATS: env.EA_EXPORT_RECEIVING_STATS ?? "CareerMode_GetWeeklyReceivingStatsExport",
  DEFENSIVE_STATS: env.EA_EXPORT_DEFENSIVE_STATS ?? "CareerMode_GetWeeklyDefensiveStatsExport",
  KICKING_STATS: env.EA_EXPORT_KICKING_STATS ?? "CareerMode_GetWeeklyKickingStatsExport",
  PASSING_STATS: env.EA_EXPORT_PASSING_STATS ?? "CareerMode_GetWeeklyPassingStatsExport",
  TEAM_ROSTER: env.EA_EXPORT_TEAM_ROSTER ?? "CareerMode_GetTeamRostersExport",
} as const;

// ── EA response types (documented from real payloads; see snallabot ea_constants.ts) ──

export type AccountToken = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
};

export type TokenInfo = { pid_id: string; expires_in: number; user_id: string };

export type Entitlement = {
  entitlementTag: string;
  groupName: string;
  pidUri: string;
  status: string;
};

export type Entitlements = { entitlements: { entitlement: Entitlement[] } };

export type Persona = {
  displayName: string;
  name: string;
  namespaceName: EaNamespace;
  personaId: number;
  pidId: number;
  status: string;
};

export type Personas = { personas: { persona: Persona[] } };

export type BlazeAuthenticatedResponse = {
  userLoginInfo: {
    blazeId: number;
    personaDetails: { displayName: string; personaId: number };
    sessionKey: string;
  };
};

export type EaLeagueSummary = {
  leagueId: number;
  leagueName: string;
  calendarYear: number;
  numMembers: number;
  userTeamId: number;
  userTeamName: string;
  seasonText: string;
  currentWeekCompleted: boolean;
};

export type GetMyLeaguesResponse = {
  responseInfo: { value: { leagues: EaLeagueSummary[]; success: boolean; message: string } };
};

export type EaWeekInfo = {
  stageIndex: number;
  weekIndex: number;
  weekTitle: string;
  gamesPlayedCount: number;
  gameTotalCount: number;
};

export type EaSeasonInfo = {
  seasonWeek: number;
  seasonWeekType: number;
  seasonYear: number;
  calendarYear: number;
  weekTitle: string;
  seasonTitle: string;
  isLeagueStarted: boolean;
};

export type EaLeagueResponse = {
  availableWeekInfoList: EaWeekInfo[];
  careerHubInfo: { seasonInfo: EaSeasonInfo; isLeagueAdvancing: boolean };
  teamIdInfoList: Array<{ teamId: number; displayName: string; shortName: string; presentationId: number }>;
  playerCountInfo: { rosterCount: number; freeAgentCount: number; totalCount: number };
  success: boolean;
  message: string;
};

export type BlazeLeagueResponse = { responseInfo: { value: EaLeagueResponse } };
