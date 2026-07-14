import { REC_API_ROUTES } from "@rec/shared";
import type {
  ActiveCheckReview,
  AdvanceDmPreview,
  AdvanceResultInput,
  AdvanceWeekGames,
  BoxScoreJobStatus,
  BoxScoreSubmissionDetail,
  ChatMessage,
  ChatTopic,
  CommissionerNotificationsResponse,
  CompletedCommissionerTransactionsResponse,
  CommitDecision,
  CommitResult,
  DeleteLeagueResult,
  DivisionWinnerOptions,
  EosAwardPoll,
  LeagueHeaderSummary,
  LeagueIdentitiesResponse,
  LinkedRosterEntry,
  LeagueSettingsDraft,
  LeagueWeekView,
  LinkedTeamsResponse,
  ManualScoreRecordResult,
  MentionableList,
  PerformanceTag,
  Recruit,
  RecruitStatus,
  TransferEntry,
  TransferStatus,
  WatchedPlayer,
  WeeklyH2hGamesResponse,
  HubReactionKey,
  HubResponse,
  HubMatchupSchedule,
  MediaPortalResponse,
  WagerOptionsResponse,
  PeerWagerBoardResponse,
  ChallengeableCoachesResponse,
  OpenTeamsResponse,
  RoleMgmtMember,
  RoleMgmtRoleKey,
  ScheduleTeam,
  TeamManagementSummary,
  TeamScheduleManualState,
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
    throw new Error("Your session has expired — run /hub again in Discord.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`REC API request failed: ${response.status} ${body}`);
  }
  return response.json() as Promise<T>;
}

export const recApi = {
  getHub: (guildId: string) =>
    recApiFetch<HubResponse>("/v1/hub/view", { method: "POST", body: JSON.stringify({ guildId }) }),
  toggleHubHighlightReaction: (input: { guildId: string; highlightId: string; reactionKey: HubReactionKey }) =>
    recApiFetch<{ ok: true }>("/v1/hub/highlights/react", { method: "POST", body: JSON.stringify(input) }),
  recordHubHighlightView: (input: { guildId: string; highlightId: string }) =>
    recApiFetch<{ viewCount: number }>("/v1/hub/highlights/view", { method: "POST", body: JSON.stringify(input) }),
  recordHubStreamView: (input: { guildId: string; streamLogId: string }) =>
    recApiFetch<{ viewCount: number }>("/v1/hub/streams/view", { method: "POST", body: JSON.stringify(input) }),
  toggleHubStreamReaction: (input: { guildId: string; streamLogId: string; reactionKey: "like" | "dislike" }) =>
    recApiFetch<{ ok: true }>("/v1/hub/streams/react", { method: "POST", body: JSON.stringify(input) }),
  publishHubAnnouncement: (input: { guildId: string; title: string; body: string }) =>
    recApiFetch<{ recorded: true }>("/v1/hub/announcements/publish", { method: "POST", body: JSON.stringify(input) }),
  publishHubStory: (input: { guildId: string; headline: string; body: string; storyType: "headline" | "article" }) =>
    recApiFetch<{ published: true; id: string }>("/v1/hub/stories/publish", { method: "POST", body: JSON.stringify(input) }),
  uploadHubMediaImage: (guildId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return recApiFetch<UploadImageResponse>(`/v1/hub/media/upload-image?guildId=${encodeURIComponent(guildId)}`, { method: "POST", body: formData });
  },
  getHubMediaPortal: (guildId: string) =>
    recApiFetch<MediaPortalResponse>("/v1/hub/media/portal", { method: "POST", body: JSON.stringify({ guildId }) }),
  submitHubMediaArticle: (input: { guildId: string; title: string; body: string; imageUrl?: string | null }) =>
    recApiFetch<{ submitted: true; id: string }>("/v1/hub/media/article/submit", { method: "POST", body: JSON.stringify(input) }),
  submitHubInterview: (input: { guildId: string; tagOpponent?: boolean; answers: Array<{ questionId: string; question: string; answer: string }> }) =>
    recApiFetch<{ submitted: true; id: string }>("/v1/hub/media/interview/submit", { method: "POST", body: JSON.stringify(input) }),
  publishCommissionerMediaArticle: (input: { guildId: string; title: string; body: string; imageUrl?: string | null; immediatePost?: boolean }) =>
    recApiFetch<{ published?: true; scheduled?: true; id: string; storyId?: string }>("/v1/hub/media/commissioner-article", { method: "POST", body: JSON.stringify(input) }),
  reviewMedia: (input: { guildId: string; reviewId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/hub/media/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  getHubMatchupSchedule: (input: { guildId: string; weekNumber?: number | null }) =>
    recApiFetch<HubMatchupSchedule>("/v1/hub/matchups/schedule", { method: "POST", body: JSON.stringify(input) }),
  getMyTeamSchedule: (guildId: string) =>
    recApiFetch<TeamScheduleManualState>("/v1/hub/my-team-schedule", { method: "POST", body: JSON.stringify({ guildId }) }),
  voteGameOfWeek: (input: { guildId: string; pollId: string; selectedTeamId: string }) =>
    recApiFetch<{ voted: true }>("/v1/hub/gotw/vote", { method: "POST", body: JSON.stringify(input) }),
  closeGameOfWeekVoting: (input: { guildId: string; pollId: string }) =>
    recApiFetch<{ closed: true }>("/v1/hub/gotw/close", { method: "POST", body: JSON.stringify(input) }),
  getWagerOptions: (input: { guildId: string; gameId: string }) =>
    recApiFetch<WagerOptionsResponse>("/v1/wagers/options", { method: "POST", body: JSON.stringify(input) }),
  placeHouseWager: (input: { guildId: string; gameId: string; market: string; pick: string; stake: number; customLine?: number | null }) =>
    recApiFetch<{ wager: unknown; walletBalance: number; payout: number; marketLabel: string; sideLabel: string }>("/v1/wagers/place-house", { method: "POST", body: JSON.stringify(input) }),
  placeParlay: (input: { guildId: string; stake: number; legs: Array<{ gameId: string; market: string; pick: string; customLine?: number | null }> }) =>
    recApiFetch<{ wager: unknown; payout: number; combinedOdds: number; legs: string[] }>("/v1/wagers/place-parlay", { method: "POST", body: JSON.stringify(input) }),
  placePeerWager: (input: { guildId: string; gameId: string; market: string; pick: string; stake: number; challengeType: "open" | "direct"; targetUserId?: string | null; customLine?: number | null }) =>
    recApiFetch<{ wager: unknown; payout: number; marketLabel: string; proposerPickLabel: string }>("/v1/wagers/place-peer", { method: "POST", body: JSON.stringify(input) }),
  acceptPeerWager: (input: { guildId: string; wagerId: string }) =>
    recApiFetch<{ wager: unknown }>("/v1/wagers/accept-peer", { method: "POST", body: JSON.stringify(input) }),
  getPeerWagerBoard: (guildId: string) =>
    recApiFetch<PeerWagerBoardResponse>("/v1/wagers/peer-board", { method: "POST", body: JSON.stringify({ guildId }) }),
  listChallengeableCoaches: (guildId: string) =>
    recApiFetch<ChallengeableCoachesResponse>("/v1/wagers/challengeable-coaches", { method: "POST", body: JSON.stringify({ guildId }) }),
  toggleHubStoryReaction: (input: { guildId: string; storyId: string; reactionKey: "like" | "dislike" }) =>
    recApiFetch<{ ok: true }>("/v1/hub/stories/react", { method: "POST", body: JSON.stringify(input) }),
  toggleHubGameReaction: (input: { guildId: string; gameId: string; reactionKey: "like" | "dislike" }) =>
    recApiFetch<{ ok: true }>("/v1/hub/games/react", { method: "POST", body: JSON.stringify(input) }),
  listHubStoryComments: (input: { guildId: string; storyId: string }) =>
    recApiFetch<{ comments: import("../types/api.js").StoryComment[] }>("/v1/hub/stories/comments/list", { method: "POST", body: JSON.stringify(input) }),
  addHubStoryComment: (input: { guildId: string; storyId: string; body: string }) =>
    recApiFetch<{ comments: import("../types/api.js").StoryComment[] }>("/v1/hub/stories/comments/add", { method: "POST", body: JSON.stringify(input) }),

  // Schedule
  listScheduleTeams: (guildId: string) =>
    recApiFetch<{ teams: ScheduleTeam[] }>("/v1/schedule/teams", { method: "POST", body: JSON.stringify({ guildId }) }),
  getTeamScheduleManualState: (input: { guildId: string; teamId: string }) =>
    recApiFetch<TeamScheduleManualState>(REC_API_ROUTES.teamScheduleManualState, { method: "POST", body: JSON.stringify(input) }),
  commitTeamScheduleDecisions: (input: { guildId: string; teamId: string; decisions: CommitDecision[]; byeWeeks?: number[] }) =>
    recApiFetch<CommitResult>(REC_API_ROUTES.teamScheduleCommit, { method: "POST", body: JSON.stringify(input) }),
  getTeamManagementSummary: (guildId: string) =>
    recApiFetch<TeamManagementSummary>(REC_API_ROUTES.teamManagementSummary, { method: "POST", body: JSON.stringify({ guildId }) }),
  getLinkedRoster: (guildId: string) =>
    recApiFetch<{ entries: LinkedRosterEntry[] }>(REC_API_ROUTES.linkedRoster, { method: "POST", body: JSON.stringify({ guildId }) }),

  // League header (AppShell)
  getLeagueHeaderSummary: (guildId: string) =>
    recApiFetch<LeagueHeaderSummary>(REC_API_ROUTES.leagueHeaderSummary, { method: "POST", body: JSON.stringify({ guildId }) }),

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
  transferMyFunds: (input: { guildId: string; amount: number; direction: "to_savings" | "from_savings" }) =>
    recApiFetch<{ transferred: number; direction: string; wallet_balance: number; savings_balance: number }>("/v1/users/me/wallet/transfer", { method: "POST", body: JSON.stringify(input) }),
  createMyPurchase: (input: { guildId: string; purchaseType: string; details: Record<string, unknown> }) =>
    recApiFetch<any>("/v1/purchases/create", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  listHubLegends: (guildId: string) => recApiFetch<{ legends: any[] }>("/v1/legends/catalog", { method: "POST", body: JSON.stringify({ guildId }) }),
  listHubLegendAvailability: (guildId: string) => recApiFetch<{ soldLegendIds: string[] }>("/v1/legends/availability", { method: "POST", body: JSON.stringify({ guildId }) }),
  purchaseHubLegend: (input: { guildId: string; legendId: string; replacePlayerRequest?: string | null }) =>
    recApiFetch<any>("/v1/legends/purchase", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  correctBoxScore: (input: { submissionId: string; field: string; team1?: string | null; team2?: string | null; gameId?: string | null }) =>
    recApiFetch<BoxScoreSubmissionDetail>("/v1/box-score/correct", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),

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
  recordManualScore: (input: { guildId: string; gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null; manualStats?: { home?: Record<string, unknown>; away?: Record<string, unknown> }; performanceTags?: { home?: PerformanceTag[]; away?: PerformanceTag[] } }) =>
    recApiFetch<ManualScoreRecordResult>("/v1/league-week/manual-scores/record", { method: "POST", body: JSON.stringify(input) }),

  // Players to Watch (per-team persistent list, selectable when tagging a game result)
  listWatchedPlayers: (guildId: string, teamId: string) =>
    recApiFetch<{ players: WatchedPlayer[] }>("/v1/watched-players/list", { method: "POST", body: JSON.stringify({ guildId, teamId }) }),
  createWatchedPlayer: (input: { guildId: string; teamId: string; playerName: string; position: string; classYear?: WatchedPlayer["classYear"] }) =>
    recApiFetch<{ player: WatchedPlayer }>("/v1/watched-players/create", { method: "POST", body: JSON.stringify(input) }),
  updateWatchedPlayer: (input: { guildId: string; id: string; playerName: string; position: string; classYear?: WatchedPlayer["classYear"] }) =>
    recApiFetch<{ player: WatchedPlayer }>("/v1/watched-players/update", { method: "POST", body: JSON.stringify(input) }),
  removeWatchedPlayer: (guildId: string, id: string) =>
    recApiFetch<{ removed: true }>("/v1/watched-players/remove", { method: "POST", body: JSON.stringify({ guildId, id }) }),

  // Recruiting tracker
  listRecruits: (guildId: string) =>
    recApiFetch<{ recruits: Recruit[] }>("/v1/recruiting/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  createRecruit: (input: { guildId: string; playerName: string; position: string; homeCity?: string | null; homeState?: string | null; starRating: number }) =>
    recApiFetch<{ recruit: Recruit }>("/v1/recruiting/create", { method: "POST", body: JSON.stringify(input) }),
  updateRecruitStatus: (input: { guildId: string; id: string; status: RecruitStatus; committedTeamId?: string | null; committedTeamExternal?: string | null; commitDate?: string | null }) =>
    recApiFetch<{ recruit: Recruit }>("/v1/recruiting/update-status", { method: "POST", body: JSON.stringify(input) }),
  deleteRecruit: (guildId: string, id: string) =>
    recApiFetch<{ deleted: true }>("/v1/recruiting/delete", { method: "POST", body: JSON.stringify({ guildId, id }) }),

  // Transfer portal tracker
  listTransferEntries: (guildId: string) =>
    recApiFetch<{ entries: TransferEntry[] }>("/v1/transfer-portal/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  createTransferEntry: (input: { guildId: string; playerName: string; position: string; classYear?: TransferEntry["classYear"]; originTeamId: string; entryDate?: string | null }) =>
    recApiFetch<{ entry: TransferEntry }>("/v1/transfer-portal/create", { method: "POST", body: JSON.stringify(input) }),
  updateTransferStatus: (input: { guildId: string; id: string; status: TransferStatus; destinationTeamId?: string | null; destinationTeamExternal?: string | null }) =>
    recApiFetch<{ entry: TransferEntry }>("/v1/transfer-portal/update-status", { method: "POST", body: JSON.stringify(input) }),
  deleteTransferEntry: (guildId: string, id: string) =>
    recApiFetch<{ deleted: true }>("/v1/transfer-portal/delete", { method: "POST", body: JSON.stringify({ guildId, id }) }),

  // Commissioner notification center
  listCommissionerNotifications: (guildId: string) =>
    recApiFetch<CommissionerNotificationsResponse>("/v1/notifications/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  listCompletedCommissionerTransactions: (guildId: string) =>
    recApiFetch<CompletedCommissionerTransactionsResponse>("/v1/notifications/completed", { method: "POST", body: JSON.stringify({ guildId }) }),

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
  prepareEosPayouts: (input: { guildId: string }) =>
    recApiFetch<unknown>("/v1/league-week/eos-payouts/prepare", { method: "POST", body: JSON.stringify({ ...input, requestedByDiscordId: "web-dashboard" }) }),

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

  // Settings (Phase 2)
  getLeagueSettingsDraft: (guildId: string) =>
    recApiFetch<{ draft: LeagueSettingsDraft }>("/v1/setup/league/config", { method: "POST", body: JSON.stringify({ guildId }) }),
  updateLeagueSettings: (draft: LeagueSettingsDraft) =>
    recApiFetch<unknown>("/v1/setup/league/config/update", { method: "POST", body: JSON.stringify(draft) }),

  // First-Time Setup (Phase 2) — omitted fields fall back to CreateLeagueSchema's Zod
  // defaults server-side, so a minimal payload here is intentional, not a shortcut.
  createLeague: (input: { guildId: string; name: string; game: string; leagueType?: string; activeRostersEnabled?: boolean }) =>
    recApiFetch<{ league: { id: string; name: string }; defaultTeams: unknown[] }>("/v1/setup/league/create", { method: "POST", body: JSON.stringify(input) }),

  // Advance (Phase 2) — GOTW polls, game-channel creation, @everyone announcements, and
  // actual DM delivery stay Discord-only (they need the live bot process); everything below
  // is the pure-data subset of Advance Week that doesn't.
  getAdvanceWeekGames: (guildId: string) =>
    recApiFetch<AdvanceWeekGames>("/v1/league-week/advance-games", { method: "POST", body: JSON.stringify({ guildId }) }),
  completeAdvanceWeek: (input: { guildId: string; nextWeekNumber: number; nextSeasonStage: string; results: AdvanceResultInput[] }) =>
    recApiFetch<unknown>("/v1/league-week/advance-complete", { method: "POST", body: JSON.stringify({ ...input, advancedByDiscordId: "web-dashboard" }) }),
  getDivisionWinnerOptions: (guildId: string) =>
    recApiFetch<DivisionWinnerOptions>("/v1/league-week/division-winner-options", { method: "POST", body: JSON.stringify({ guildId }) }),
  saveDivisionWinners: (input: { guildId: string; seasonNumber: number; winners: Array<{ divisionKey: string; teamId: string }> }) =>
    recApiFetch<unknown>("/v1/league-week/division-winners", { method: "POST", body: JSON.stringify({ ...input, selectedByDiscordId: "web-dashboard" }) }),
  setNextAdvanceTime: (input: { guildId: string; year: number; month: number; day: number; hour: number; minute: number; tzLabel: string }) =>
    recApiFetch<unknown>("/v1/league-week/set-next-advance", { method: "POST", body: JSON.stringify(input) }),
  previewAdvanceDms: (guildId: string) =>
    recApiFetch<AdvanceDmPreview>("/v1/league-week/advance-dms", { method: "POST", body: JSON.stringify({ guildId }) }),

  // Commissioner Chat + Voting
  listChatMessages: (input: { guildId: string; sinceIso?: string | null }) =>
    recApiFetch<{ messages: ChatMessage[] }>("/v1/commissioner-chat/messages/list", { method: "POST", body: JSON.stringify(input) }),
  postChatMessage: (input: { guildId: string; body: string }) =>
    recApiFetch<{ message: ChatMessage }>("/v1/commissioner-chat/messages/post", { method: "POST", body: JSON.stringify(input) }),
  listChatTopics: (guildId: string) =>
    recApiFetch<{ topics: ChatTopic[] }>("/v1/commissioner-chat/topics/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  createChatTopic: (input: { guildId: string; title: string; description?: string | null; options: string[]; closesAt?: string | null }) =>
    recApiFetch<{ topic: ChatTopic }>("/v1/commissioner-chat/topics/create", { method: "POST", body: JSON.stringify(input) }),
  voteOnChatTopic: (input: { guildId: string; topicId: string; optionIndex: number }) =>
    recApiFetch<{ ok: true }>("/v1/commissioner-chat/topics/vote", { method: "POST", body: JSON.stringify(input) }),
  closeChatTopic: (input: { guildId: string; topicId: string }) =>
    recApiFetch<{ ok: true }>("/v1/commissioner-chat/topics/close", { method: "POST", body: JSON.stringify(input) }),
  getMentionableCommissioners: (guildId: string) =>
    recApiFetch<MentionableList>(REC_API_ROUTES.commissionerChatMentionable, { method: "POST", body: JSON.stringify({ guildId }) }),

  // Home page's weekly H2H panel
  getWeeklyH2hGames: (guildId: string) =>
    recApiFetch<WeeklyH2hGamesResponse>(REC_API_ROUTES.weeklyH2hGames, { method: "POST", body: JSON.stringify({ guildId }) }),
};
