import { REC_API_ROUTES } from "@rec/shared";
import type {
  ActiveCheckReview,
  BoxScoreJobStatus,
  BoxScoreSubmissionDetail,
  CfbTeamScheduleManualState,
  CommissionerNotificationsResponse,
  CommitDecision,
  CommitResult,
  DeleteLeagueResult,
  EosAwardPoll,
  LeagueIdentitiesResponse,
  LeagueWeekView,
  LinkedTeamsResponse,
  ManualScoreRecordResult,
  OpenTeamsResponse,
  RoleMgmtMember,
  RoleMgmtRoleKey,
  ScheduleTeam,
  UploadImageResponse,
} from "../types/api.js";

const REC_API_TIMEOUT_MS = 30_000;

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

// There's no silent recovery from a 401 here — the token comes from a link the bot mints
// once when the dashboard button is clicked, and there's no ongoing Discord session in the
// browser to draw a fresh one from. An expired/invalid session just means "go back to
// Discord and click Open Web Dashboard again," which this error message says directly.
export async function recApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies (image uploads) need the browser to set its own multipart boundary
  // header — setting content-type: application/json here would break the parse server-side.
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${import.meta.env.VITE_REC_CORE_API_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REC_API_TIMEOUT_MS),
    headers: {
      ...(isFormData ? {} : { "content-type": "application/json" }),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401) {
    throw new Error("Your session has expired — reopen the dashboard from Discord's League Mgmt menu.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`REC API request failed: ${response.status} ${body}`);
  }
  return response.json() as Promise<T>;
}

export const recApi = {
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

  // Box score review (schedule builder — see TeamScheduleForm.tsx)
  getBoxScoreSubmission: (submissionId: string) =>
    recApiFetch<BoxScoreSubmissionDetail>("/v1/box-score/get", { method: "POST", body: JSON.stringify({ submissionId }) }),
  reviewBoxScore: (input: { submissionId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    // reviewedByDiscordId is required by the schema but overridden server-side from the
    // session for browser calls — the placeholder here is only exercised by direct bot calls.
    recApiFetch<unknown>("/v1/box-score/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),

  // Box score upload + OCR submit (schedule builder)
  uploadBoxScoreImage: (guildId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return recApiFetch<UploadImageResponse>(`/v1/box-score/upload-image?guildId=${encodeURIComponent(guildId)}`, { method: "POST", body: formData });
  },
  submitBoxScore: (input: {
    guildId: string;
    discordId: string;
    imageUrls: string[];
    weekNumber?: number | null;
    seasonNumber?: number | null;
    expectedGameId?: string | null;
    commissionerSubmission?: boolean;
  }) => recApiFetch<{ jobId: string; status: "processing" }>("/v1/box-score/submit", { method: "POST", body: JSON.stringify(input) }),
  pollBoxScoreJob: (jobId: string) =>
    recApiFetch<BoxScoreJobStatus>("/v1/box-score/job", { method: "POST", body: JSON.stringify({ jobId }) }),

  // Manual final-score entry (schedule builder)
  recordManualScore: (input: { guildId: string; gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null }) =>
    recApiFetch<ManualScoreRecordResult>("/v1/league-week/manual-scores/record", { method: "POST", body: JSON.stringify(input) }),

  // Commissioner notification center
  listCommissionerNotifications: (guildId: string) =>
    recApiFetch<CommissionerNotificationsResponse>("/v1/notifications/list", { method: "POST", body: JSON.stringify({ guildId }) }),

  // Notification detail/resolve actions — reviewedBy/loggedBy/reviewer placeholders are
  // required by each schema but overridden server-side from the session for browser calls,
  // same convention as reviewBoxScore above.
  reviewPurchase: (input: { guildId: string; purchaseId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/purchases/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  reviewHighlight: (input: { guildId: string; reviewId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/highlights/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  reviewStream: (input: { guildId: string; reviewId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/streams/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  approveTeamRequest: (input: { guildId: string; requestId: string }) =>
    recApiFetch<unknown>("/v1/team-requests/approve", { method: "POST", body: JSON.stringify({ ...input, reviewerDiscordId: "web-dashboard" }) }),
  rejectTeamRequest: (input: { guildId: string; requestId: string }) =>
    recApiFetch<unknown>("/v1/team-requests/reject", { method: "POST", body: JSON.stringify({ ...input, reviewerDiscordId: "web-dashboard" }) }),
  settleWager: (input: { guildId: string; wagerId: string }) =>
    recApiFetch<unknown>("/v1/wagers/settle", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  approveWeeklyScoreReview: (input: { guildId: string; reviewId: string }) =>
    recApiFetch<unknown>("/v1/league-week/weekly-scores/review/approve", { method: "POST", body: JSON.stringify({ ...input, loggedByDiscordId: "web-dashboard" }) }),
  cancelWeeklyScoreReview: (input: { guildId: string; reviewId: string }) =>
    recApiFetch<unknown>("/v1/league-week/weekly-scores/review/cancel", { method: "POST", body: JSON.stringify(input) }),
  issueEosPayoutBatch: (input: { guildId: string; batchId: string }) =>
    recApiFetch<unknown>("/v1/league-week/eos-payouts/issue-batch", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),

  // Active Check resolve view
  getActiveCheckReview: (input: { guildId: string; eventId: string }) =>
    recApiFetch<ActiveCheckReview>("/v1/active-checks/review", { method: "POST", body: JSON.stringify(input) }),
  keepActiveCheckUsers: (input: { guildId: string; eventId: string; discordIds: string[] }) =>
    recApiFetch<ActiveCheckReview>("/v1/active-checks/keep", { method: "POST", body: JSON.stringify(input) }),
  markActiveCheckBooted: (input: { guildId: string; eventId: string; discordIds: string[] }) =>
    recApiFetch<{ updated: number }>("/v1/active-checks/booted", { method: "POST", body: JSON.stringify(input) }),
  finishActiveCheckReview: (input: { guildId: string; eventId: string }) =>
    recApiFetch<{ ok: true }>("/v1/active-checks/finish-review", { method: "POST", body: JSON.stringify(input) }),

  // EOS Award resolve view
  getEosAwardPoll: (input: { guildId: string; pollId: string }) =>
    recApiFetch<{ poll: EosAwardPoll }>("/v1/league-week/eos-awards/get", { method: "POST", body: JSON.stringify(input) }),
  settleEosAwardPoll: (input: { guildId: string; pollId: string; voteCounts: Record<string, number> }) =>
    recApiFetch<unknown>("/v1/league-week/eos-awards/settle", { method: "POST", body: JSON.stringify(input) }),

  // Delete League (Phase 2)
  viewLeagueWeek: (guildId: string) =>
    recApiFetch<LeagueWeekView>("/v1/league-week/view", { method: "POST", body: JSON.stringify({ guildId }) }),
  deleteLeagueData: (input: { guildId: string; confirmationText: string }) =>
    recApiFetch<DeleteLeagueResult>("/v1/setup/league/delete", { method: "POST", body: JSON.stringify(input) }),

  // Roles (Phase 2)
  listRoleMgmtMembers: (guildId: string) =>
    recApiFetch<{ members: RoleMgmtMember[] }>("/v1/roles/members", { method: "POST", body: JSON.stringify({ guildId }) }),
  updateMemberRole: (input: { guildId: string; discordId: string; roleKey: RoleMgmtRoleKey; action: "add" | "remove" }) =>
    recApiFetch<{ ok: true }>("/v1/roles/update", { method: "POST", body: JSON.stringify(input) }),
};
