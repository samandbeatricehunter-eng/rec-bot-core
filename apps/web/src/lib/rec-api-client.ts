import { REC_API_ROUTES } from "@rec/shared";
import type {
  BoxScoreSubmissionDetail,
  CfbTeamScheduleManualState,
  CommitDecision,
  CommitResult,
  LeagueIdentitiesResponse,
  LinkedTeamsResponse,
  OpenTeamsResponse,
  PendingBoxScoresResponse,
  ScheduleTeam,
} from "../types/api.js";

const REC_API_TIMEOUT_MS = 30_000;

let authToken: string | null = null;
// Set by AuthProvider — lets the low-level fetch wrapper trigger a silent re-authorize on
// a 401 without this module needing to know anything about the Discord SDK/auth flow.
let onUnauthorized: (() => Promise<string | null>) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => Promise<string | null>) | null) {
  onUnauthorized = handler;
}

async function rawFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_REC_CORE_API_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REC_API_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`REC API request failed: ${response.status} ${body}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

// Authenticated fetch wrapper — retries once via silent re-authorize on a 401 before
// surfacing the error, so a JWT expiring mid-session doesn't hard-crash the screen.
export async function recApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await rawFetch<T>(path, init);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 && onUnauthorized) {
      const newToken = await onUnauthorized();
      if (newToken) {
        setAuthToken(newToken);
        return rawFetch<T>(path, init);
      }
    }
    throw error;
  }
}

export const recApi = {
  exchangeActivityAuth: (input: { code: string; guildId: string }) =>
    rawFetch<{ token: string; discordId: string; guildId: string; username: string; globalName: string | null }>(
      REC_API_ROUTES.activityAuthExchange,
      { method: "POST", body: JSON.stringify(input) },
    ),

  // Schedule
  listScheduleTeams: (guildId: string) =>
    recApiFetch<{ teams: ScheduleTeam[] }>("/v1/schedule/teams", { method: "POST", body: JSON.stringify({ guildId }) }),
  getCfbTeamScheduleManualState: (input: { guildId: string; teamId: string }) =>
    recApiFetch<CfbTeamScheduleManualState>(REC_API_ROUTES.cfbTeamScheduleManualState, { method: "POST", body: JSON.stringify(input) }),
  commitCfbTeamSchedule: (input: { guildId: string; teamId: string; decisions: CommitDecision[] }) =>
    recApiFetch<CommitResult>("/v1/schedule/cfb-team-import-commit", { method: "POST", body: JSON.stringify(input) }),

  // Team ownership
  listLinkedUsersTeams: (guildId: string) => recApiFetch<LinkedTeamsResponse>(REC_API_ROUTES.linkedUsersTeams(guildId)),
  listOpenTeams: (guildId: string) => recApiFetch<OpenTeamsResponse>(REC_API_ROUTES.openTeams(guildId)),
  listLeagueIdentities: (guildId: string) => recApiFetch<LeagueIdentitiesResponse>(`/v1/guilds/${guildId}/identities`),
  linkUserToTeam: (input: { guildId: string; discordId: string; teamId: string }) =>
    recApiFetch<unknown>(REC_API_ROUTES.linkUserToTeam, { method: "POST", body: JSON.stringify(input) }),
  unlinkTeam: (input: { guildId: string; teamId: string }) =>
    recApiFetch<unknown>(REC_API_ROUTES.unlinkTeam, { method: "POST", body: JSON.stringify(input) }),

  // Box score inbox
  listPendingBoxScores: (guildId: string) =>
    recApiFetch<PendingBoxScoresResponse>("/v1/box-score/pending", { method: "POST", body: JSON.stringify({ guildId }) }),
  getBoxScoreSubmission: (submissionId: string) =>
    recApiFetch<BoxScoreSubmissionDetail>("/v1/box-score/get", { method: "POST", body: JSON.stringify({ submissionId }) }),
  reviewBoxScore: (input: { submissionId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    // reviewedByDiscordId is required by the schema but overridden server-side from the
    // session for Activity calls — the placeholder here is only exercised by direct bot calls.
    recApiFetch<unknown>("/v1/box-score/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "activity" }) }),
};
