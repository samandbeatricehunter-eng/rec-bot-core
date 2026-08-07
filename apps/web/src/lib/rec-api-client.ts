import { REC_API_ROUTES } from "@rec/shared";
import type { ChatChannelSummary, ChatChannelType, ChatMarkReadInput, ChatReactionSummary } from "@rec/shared";
import type {
  ActiveCheckReview,
  AdvanceResultInput,
  AdvanceWeekGames,
  BoxScoreJobStatus,
  BoxScoreSubmissionDetail,
  CfbBaselineApplyResponse,
  CfbRollForwardResponse,
  CfbRosterSeedStatus,
  ChatAttachment,
  CommissionerPoll,
  ChatMessage,
  ChatTopic,
  PublicPoll,
  GameChatChannel,
  GameChatMessage,
  LeagueChatMember,
  LeagueChatMessage,
  CommissionerNotificationsResponse,
  CompletedCommissionerTransactionsResponse,
  CommissionerPendingSummary,
  HighlightReviewDetail,
  CommitDecision,
  CommitResult,
  DeleteLeagueResult,
  DivisionWinnerOptions,
  EosAwardPoll,
  EosAwardVotingPoll,
  EosBallotSessionInfo,
  GotwCandidate,
  GotwPollStatus,
  MyEosPayoutProgress,
  PendingEosLedgers,
  RecPayoutTier,
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
  PlayerStatSubmission,
  WeeklyH2hGamesResponse,
  HubReactionKey,
  HubResponse,
  HubMatchupSchedule,
  MediaPortalResponse,
  WagerOptionsResponse,
  WeekWagerLinesResponse,
  TeamRosterResponse,
  AssignableBoxScoreStats,
  TurnoverKind,
  RosterDepartureStatus,
  RosterLifecycleResult,
  PeerWagerBoardResponse,
  MyWagersResponse,
  ChallengeableCoachesResponse,
  OpenWagersForCommissionerResponse,
  ReversibleTransactionsResponse,
  OpenTeamsResponse,
  RoleMgmtMember,
  TeamLinkMatrix,
  Trade,
  TradeLeg,
  TradeLegInput,
  RoleMgmtRoleKey,
  ScheduleTeam,
  TeamManagementSummary,
  TeamScheduleManualState,
  UploadImageResponse,
} from "../types/api.js";

const REC_API_TIMEOUT_MS = 30_000;

declare global {
  interface Window {
    __REC_WEB_CONFIG__?: {
      VITE_REC_CORE_API_URL?: string;
      VITE_SITE_PUBLIC_URL?: string;
    };
  }
}

export function apiBaseUrl(): string {
  const fromRuntime = typeof window !== "undefined"
    ? window.__REC_WEB_CONFIG__?.VITE_REC_CORE_API_URL?.trim()
    : undefined;
  return (
    fromRuntime
    || String(import.meta.env.VITE_REC_CORE_API_URL ?? "").trim()
    || "https://recapi-production.up.railway.app"
  );
}

let authToken: string | null = null;
let hubGuildId: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Read-only access to the current session token — chat-realtime-client.ts needs it to
 * authenticate the WebSocket handshake, which (unlike fetch) can't set an Authorization header. */
export function getAuthToken(): string | null {
  return authToken;
}

export function wsBaseUrl(): string {
  return apiBaseUrl().replace(/^http/, "ws");
}

export function setHubGuildId(guildId: string | null) {
  hubGuildId = guildId;
}

// There's no silent recovery from a 401 here — the token comes from a link the bot mints
// once when the dashboard button is clicked, and there's no ongoing Discord session in the
// browser to draw a fresh one from. An expired/invalid session just means "go back to
// Discord and click Open Web Dashboard again," which this error message says directly.
export async function recApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies (image uploads) need the browser to set its own multipart boundary
  // header — setting content-type: application/json here would break the parse server-side.
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REC_API_TIMEOUT_MS),
    headers: {
      ...(isFormData ? {} : { "content-type": "application/json" }),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(hubGuildId ? { "x-rec-guild-id": hubGuildId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401) {
    throw new Error("Your session has expired — sign in again on rec-leagues.com, or run /app in Discord.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`REC API request failed: ${response.status} ${body}`);
  }
  return response.json() as Promise<T>;
}

export const recApi = {
  getMyLeagueHistory: (guildId: string) => recApiFetch<{ leagues: Array<any> }>(`/v1/users/me/league-history?guildId=${encodeURIComponent(guildId)}`),
  getHub: (guildId: string) =>
    recApiFetch<HubResponse>("/v1/hub/view", { method: "POST", body: JSON.stringify({ guildId }) }),
  getHubBootstrapStatus: (guildId: string) =>
    recApiFetch<{ leagueExists: boolean; canSetup: boolean }>("/v1/hub/bootstrap-status", { method: "POST", body: JSON.stringify({ guildId }) }),
  retireFromHub: (guildId: string) =>
    recApiFetch<{ ok: true }>("/v1/hub/retire", { method: "POST", body: JSON.stringify({ guildId }) }),
  toggleHubHighlightReaction: (input: { guildId: string; highlightId: string; reactionKey: HubReactionKey }) =>
    recApiFetch<{ ok: true }>("/v1/hub/highlights/react", { method: "POST", body: JSON.stringify(input) }),
  recordHubHighlightView: (input: { guildId: string; highlightId: string }) =>
    recApiFetch<{ viewCount: number }>("/v1/hub/highlights/view", { method: "POST", body: JSON.stringify(input) }),
  createHighlightDirectUpload: (input: { guildId: string; gameId: string; fileName?: string | null }) =>
    recApiFetch<{ highlightId: string; uploadURL: string; streamUid: string; maxDurationSeconds: number; maxHeight: number }>(
      "/v1/hub/highlights/direct-upload",
      { method: "POST", body: JSON.stringify(input) },
    ),
  markHighlightUploadReceived: (input: { guildId: string; highlightId: string }) =>
    recApiFetch<{ highlightId: string; mediaStatus: string }>("/v1/hub/highlights/upload-received", { method: "POST", body: JSON.stringify(input) }),
  getHighlightUploadStatus: (input: { guildId: string; highlightId: string }) =>
    recApiFetch<{
      highlightId: string;
      mediaStatus: string;
      playbackUrl: string | null;
      streamUid: string | null;
      iframeUrl: string | null;
      maxHeight: number | null;
      storageProvider: string;
      failureReason?: string | null;
    }>("/v1/hub/highlights/status", { method: "POST", body: JSON.stringify(input) }),
  recordHubStreamView: (input: { guildId: string; streamLogId: string }) =>
    recApiFetch<{ viewCount: number }>("/v1/hub/streams/view", { method: "POST", body: JSON.stringify(input) }),
  toggleHubStreamReaction: (input: { guildId: string; streamLogId: string; reactionKey: "like" | "dislike" }) =>
    recApiFetch<{ ok: true }>("/v1/hub/streams/react", { method: "POST", body: JSON.stringify(input) }),
  publishHubAnnouncement: (input: { guildId: string; title: string; body: string }) =>
    recApiFetch<{ recorded: true }>("/v1/hub/announcements/publish", { method: "POST", body: JSON.stringify(input) }),
  getArticlePromptDigest: (input: { guildId: string; weekFrom: number; weekTo: number }) =>
    recApiFetch<{ prompt: string; resultCount: number }>("/v1/hub/publishing/article-prompt", { method: "POST", body: JSON.stringify(input) }),
  getRoundtableHostConfig: (guildId: string) =>
    recApiFetch<{ hosts: Array<{ voice: string; displayName: string; role: string; personalityKey: string | null; isCustom: boolean }>; personalities: Array<{ key: string; label: string; description: string }> }>("/v1/hub/publishing/roundtable-hosts", { method: "POST", body: JSON.stringify({ guildId }) }),
  updateRoundtableHost: (input: { guildId: string; voice: string; displayName: string; personalityKey: string }) =>
    recApiFetch<{ ok: true }>("/v1/hub/publishing/roundtable-hosts/update", { method: "POST", body: JSON.stringify(input) }),
  resetRoundtableHost: (input: { guildId: string; voice: string }) =>
    recApiFetch<{ ok: true }>("/v1/hub/publishing/roundtable-hosts/reset", { method: "POST", body: JSON.stringify(input) }),
  generateRoundtableHostName: (input: { guildId: string; seed: string }) =>
    recApiFetch<{ fullName: string }>("/v1/hub/publishing/roundtable-hosts/generate-name", { method: "POST", body: JSON.stringify(input) }),
  createCommissionerPoll: (input: { guildId: string; discordId: string; question: string; options: string[]; durationHours: number }) =>
    recApiFetch<CommissionerPoll>("/v1/polls/create", { method: "POST", body: JSON.stringify(input) }),
  listCommissionerPolls: (input: { guildId: string }) =>
    recApiFetch<{ polls: CommissionerPoll[] }>("/v1/polls/list", { method: "POST", body: JSON.stringify(input) }),
  closeCommissionerPoll: (input: { guildId: string; pollId: string }) =>
    recApiFetch<CommissionerPoll>("/v1/polls/close", { method: "POST", body: JSON.stringify(input) }),
  cancelCommissionerPoll: (input: { guildId: string; pollId: string }) =>
    recApiFetch<CommissionerPoll>("/v1/polls/cancel", { method: "POST", body: JSON.stringify(input) }),
  voteOnCommissionerPoll: (input: { guildId: string; pollId: string; optionId: number }) =>
    recApiFetch<{ ok: true }>("/v1/polls/vote", { method: "POST", body: JSON.stringify(input) }),
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
  getHubMatchupDetail: (input: { guildId: string; gameId: string }) =>
    recApiFetch<import("../types/api.js").HubMatchupDetail>("/v1/hub/matchups/detail", { method: "POST", body: JSON.stringify(input) }),
  getMatchupPreview: (input: { guildId: string; gameId: string }) =>
    recApiFetch<import("../types/api.js").MatchupPreview>("/v1/hub/matchups/preview", { method: "POST", body: JSON.stringify(input) }),
  sendHubMatchupMessage: (input: { guildId: string; gameId: string; body: string }) =>
    recApiFetch<{ message: import("../types/api.js").MatchupChatMessage }>("/v1/hub/matchups/chat/send", { method: "POST", body: JSON.stringify(input) }),
  submitMatchupHelpRequest: (input: { guildId: string; gameId: string; kind: "force_win" | "autopilot" | "matchup_issue"; message: string }) =>
    recApiFetch<{ ok: true }>("/v1/matchup-help/submit", { method: "POST", body: JSON.stringify(input) }),
  shareHubMatchupStream: (input: { guildId: string; gameId: string; url: string }) =>
    recApiFetch<{ posted: true; streamLogId: string; watchPath: string; service: string | null }>("/v1/hub/matchups/stream/share", { method: "POST", body: JSON.stringify(input) }),
  getMyTeamSchedule: (guildId: string) =>
    recApiFetch<TeamScheduleManualState>("/v1/hub/my-team-schedule", { method: "POST", body: JSON.stringify({ guildId }) }),
  getMyHighlightWeekCounts: (guildId: string) =>
    recApiFetch<{ seasonNumber: number; counts: Record<number, number> }>("/v1/hub/highlights/my-week-counts", { method: "POST", body: JSON.stringify({ guildId }) }),
  getTeamSchedule: (input: { guildId: string; teamId: string }) =>
    recApiFetch<TeamScheduleManualState>("/v1/hub/team-schedule", { method: "POST", body: JSON.stringify(input) }),
  voteGameOfWeek: (input: { guildId: string; pollId: string; selectedTeamId: string }) =>
    recApiFetch<{ voted: true }>("/v1/hub/gotw/vote", { method: "POST", body: JSON.stringify(input) }),
  closeGameOfWeekVoting: (input: { guildId: string; pollId: string }) =>
    recApiFetch<{ closed: true }>("/v1/hub/gotw/close", { method: "POST", body: JSON.stringify(input) }),
  reopenGameOfWeekVoting: (input: { guildId: string; pollId: string }) =>
    recApiFetch<{ reopened: true }>("/v1/hub/gotw/reopen", { method: "POST", body: JSON.stringify(input) }),
  cancelGameOfWeekVoting: (input: { guildId: string; pollId: string }) =>
    recApiFetch<{ cancelled: true }>("/v1/hub/gotw/cancel", { method: "POST", body: JSON.stringify(input) }),
  getWagerOptions: (input: { guildId: string; gameId: string }) =>
    recApiFetch<WagerOptionsResponse>("/v1/wagers/options", { method: "POST", body: JSON.stringify(input) }),
  getWeekWagerLines: (input: { guildId: string; weekNumber: number }) =>
    recApiFetch<WeekWagerLinesResponse>("/v1/wagers/week-lines", { method: "POST", body: JSON.stringify(input) }),
  getTeamRoster: (input: { guildId: string; teamId?: string | null }) =>
    recApiFetch<TeamRosterResponse>("/v1/roster/team", { method: "POST", body: JSON.stringify(input) }),
  setPlayerDeparture: (input: { guildId: string; playerId: string; status: RosterDepartureStatus; note?: string | null }) =>
    recApiFetch<RosterLifecycleResult>("/v1/roster/lifecycle/departure", { method: "POST", body: JSON.stringify(input) }),
  reinstatePlayer: (input: { guildId: string; playerId: string }) =>
    recApiFetch<RosterLifecycleResult>("/v1/roster/lifecycle/reinstate", { method: "POST", body: JSON.stringify(input) }),
  addTransferInPlayer: (input: { guildId: string; teamId: string; firstName: string; lastName: string; position: string; classYear?: string | null; overallRating?: number | null; note?: string | null }) =>
    recApiFetch<RosterLifecycleResult>("/v1/roster/lifecycle/transfer-in", { method: "POST", body: JSON.stringify(input) }),
  addRosterPlayer: (input: { guildId: string; teamId: string; firstName: string; lastName: string; position: string; heightInches?: number | null; weightLbs?: number | null; handedness?: string | null; overallRating?: number | null }) =>
    recApiFetch<RosterLifecycleResult>("/v1/roster/add-player", { method: "POST", body: JSON.stringify(input) }),
  submitRosterAddRequest: (input: { guildId: string; firstName: string; lastName: string; position: string; heightInches?: number | null; weightLbs?: number | null; overallRating?: number | null }) =>
    recApiFetch<{ status: "approved" | "pending"; player?: RosterLifecycleResult; requestId?: string }>("/v1/roster/add-requests/submit", { method: "POST", body: JSON.stringify(input) }),
  listRosterAddRequests: (guildId: string) =>
    recApiFetch<{ requests: Array<{ id: string; header: string; summary: string; payload: any; requester_discord_id: string | null; created_at: string }> }>("/v1/roster/add-requests/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  approveRosterAddRequest: (input: { guildId: string; requestId: string }) =>
    recApiFetch<{ player: RosterLifecycleResult }>("/v1/roster/add-requests/approve", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  denyRosterAddRequest: (input: { guildId: string; requestId: string; reason: string }) =>
    recApiFetch<{ ok: true }>("/v1/roster/add-requests/deny", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  placeHouseWager: (input: { guildId: string; gameId: string; market: string; pick: string; stake: number; customLine?: number | null }) =>
    recApiFetch<{ wager: unknown; walletBalance: number; payout: number; marketLabel: string; sideLabel: string }>("/v1/wagers/place-house", { method: "POST", body: JSON.stringify(input) }),
  placeParlay: (input: { guildId: string; stake: number; legs: Array<{ gameId: string; market: string; pick: string; customLine?: number | null }> }) =>
    recApiFetch<{ wager: unknown; payout: number; combinedOdds: number; legs: string[] }>("/v1/wagers/place-parlay", { method: "POST", body: JSON.stringify(input) }),
  placePeerWager: (input: { guildId: string; gameId: string; market: string; pick: string; stake: number; challengeType: "open" | "direct"; targetUserId?: string | null; customLine?: number | null }) =>
    recApiFetch<{ wager: unknown; payout: number; marketLabel: string; proposerPickLabel: string }>("/v1/wagers/place-peer", { method: "POST", body: JSON.stringify(input) }),
  acceptPeerWager: (input: { guildId: string; wagerId: string }) =>
    recApiFetch<{ wager: unknown }>("/v1/wagers/accept-peer", { method: "POST", body: JSON.stringify(input) }),
  cancelMyWager: (input: { guildId: string; wagerId: string }) =>
    recApiFetch<{ ok: true; refunded: number }>("/v1/wagers/cancel-mine", { method: "POST", body: JSON.stringify(input) }),
  closeGameWagering: (input: { guildId: string; gameId: string }) =>
    recApiFetch<{ closed: true; refundedCount: number }>("/v1/wagers/close-game", { method: "POST", body: JSON.stringify(input) }),
  cancelGameWagering: (input: { guildId: string; gameId: string }) =>
    recApiFetch<{ cancelled: true; refundedCount: number }>("/v1/wagers/cancel-game", { method: "POST", body: JSON.stringify(input) }),
  reopenGameWagering: (input: { guildId: string; gameId: string }) =>
    recApiFetch<{ reopened: true }>("/v1/wagers/reopen-game", { method: "POST", body: JSON.stringify(input) }),
  getPeerWagerBoard: (guildId: string) =>
    recApiFetch<PeerWagerBoardResponse>("/v1/wagers/peer-board", { method: "POST", body: JSON.stringify({ guildId }) }),
  getMyWagers: (guildId: string) =>
    recApiFetch<MyWagersResponse>("/v1/wagers/my-wagers", { method: "POST", body: JSON.stringify({ guildId }) }),
  listChallengeableCoaches: (guildId: string) =>
    recApiFetch<ChallengeableCoachesResponse>("/v1/wagers/challengeable-coaches", { method: "POST", body: JSON.stringify({ guildId }) }),
  listOpenWagersForCommissioner: (guildId: string) =>
    recApiFetch<OpenWagersForCommissionerResponse>("/v1/wagers/open", { method: "POST", body: JSON.stringify({ guildId }) }),
  commissionerCancelWager: (input: { guildId: string; wagerId: string }) =>
    recApiFetch<{ ok: true; refunded: number }>("/v1/wagers/commissioner-cancel", { method: "POST", body: JSON.stringify(input) }),
  listReversibleTransactions: (input: { guildId: string; discordId: string }) =>
    recApiFetch<ReversibleTransactionsResponse>("/v1/admin-economy/reversible-transactions", { method: "POST", body: JSON.stringify(input) }),
  reverseTransaction: (input: { guildId: string; discordId: string; ledgerId: string }) =>
    recApiFetch<{ reversed: true; ledgerId: string; amount: number }>("/v1/admin-economy/reverse-transaction", { method: "POST", body: JSON.stringify(input) }),
  listLeagueDraftPicks: (guildId: string) =>
    recApiFetch<Array<{ id: string; league_id: string; season_number: number; round: number; original_team_id: string; current_team_id: string; pick_number: number | null }>>("/v1/draft-picks/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  proposeTrade: (input: { guildId: string; receivingTeamId: string; offeredLegs: TradeLegInput[]; requestedLegs: TradeLegInput[]; offeredCoins: number; requestedCoins: number }) =>
    recApiFetch<{ status: string } | Trade>("/v1/trades/propose", { method: "POST", body: JSON.stringify(input) }),
  respondToTrade: (input: { guildId: string; tradeId: string; action: "accept" | "decline" }) =>
    recApiFetch<{ status: string }>("/v1/trades/respond", { method: "POST", body: JSON.stringify(input) }),
  withdrawTrade: (input: { guildId: string; tradeId: string }) =>
    recApiFetch<{ status: string }>("/v1/trades/withdraw", { method: "POST", body: JSON.stringify(input) }),
  reviewTrade: (input: { guildId: string; tradeId: string; action: "approve" | "reject"; note?: string }) =>
    recApiFetch<{ status: string }>("/v1/trades/review", { method: "POST", body: JSON.stringify(input) }),
  getMyTrades: (guildId: string) =>
    recApiFetch<{ trades: Trade[] }>("/v1/trades/mine", { method: "POST", body: JSON.stringify({ guildId }) }),
  getPendingReviewTrades: (guildId: string) =>
    recApiFetch<{ trades: Trade[] }>("/v1/trades/pending-review", { method: "POST", body: JSON.stringify({ guildId }) }),
  getTradeDetail: (input: { guildId: string; tradeId: string }) =>
    recApiFetch<{ trade: Trade; legs: TradeLeg[] }>("/v1/trades/detail", { method: "POST", body: JSON.stringify(input) }),
  listTradeableTeams: (guildId: string) =>
    recApiFetch<Array<{ id: string; name: string; abbreviation: string; isCpu: boolean }>>("/v1/trades/teams", { method: "POST", body: JSON.stringify({ guildId }) }),
  listTradeBlockPlayers: (guildId: string) =>
    recApiFetch<Array<{ id: string; fullName: string; position: string; overallRating: number | null; teamId: string; teamName: string; note: string | null; listedAt: string | null }>>("/v1/trades/trade-block/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  setPlayerTradeBlock: (input: { guildId: string; playerId: string; listed: boolean; note?: string }) =>
    recApiFetch<{ id: string; full_name: string }>("/v1/trades/trade-block/set", { method: "POST", body: JSON.stringify(input) }),
  toggleHubStoryReaction: (input: { guildId: string; storyId: string; reactionKey: "like" | "dislike" }) =>
    recApiFetch<{ ok: true }>("/v1/hub/stories/react", { method: "POST", body: JSON.stringify(input) }),
  toggleHubGameReaction: (input: {
    guildId: string;
    gameId: string;
    reactionKey: "love" | "like" | "goty" | "dislike" | "poop";
    comment?: string | null;
    mode?: "toggle" | "set" | "clear";
  }) =>
    recApiFetch<{ ok: true; myGotyComment?: string | null }>("/v1/hub/games/react", { method: "POST", body: JSON.stringify(input) }),
  listHubStoryComments: (input: { guildId: string; storyId: string }) =>
    recApiFetch<{ comments: import("../types/api.js").StoryComment[] }>("/v1/hub/stories/comments/list", { method: "POST", body: JSON.stringify(input) }),
  addHubStoryComment: (input: { guildId: string; storyId: string; body: string }) =>
    recApiFetch<{ comments: import("../types/api.js").StoryComment[] }>("/v1/hub/stories/comments/add", { method: "POST", body: JSON.stringify(input) }),

  // Schedule
  listScheduleTeams: (guildId: string) =>
    recApiFetch<{ teams: ScheduleTeam[] }>("/v1/schedule/teams", { method: "POST", body: JSON.stringify({ guildId }) }),
  getTeamScheduleManualState: (input: { guildId: string; teamId: string }) =>
    recApiFetch<TeamScheduleManualState>(REC_API_ROUTES.teamScheduleManualState, { method: "POST", body: JSON.stringify(input) }),
  commitTeamScheduleDecisions: (input: { guildId: string; teamId: string; decisions: CommitDecision[]; byeWeeks?: number[]; firstRoundByeWeeks?: number[] }) =>
    recApiFetch<CommitResult>(REC_API_ROUTES.teamScheduleCommit, { method: "POST", body: JSON.stringify(input) }),
  getCfpPostseason: (guildId: string) =>
    recApiFetch<import("../types/api.js").CfpPostseasonState>("/v1/schedule/cfp/state", { method: "POST", body: JSON.stringify({ guildId }) }),
  saveCfpTop25: (input: { guildId: string; rankings: Array<{ rank: number; teamId: string; conferenceChampion: boolean }> }) =>
    recApiFetch<import("../types/api.js").CfpPostseasonState>("/v1/schedule/cfp/top-25", { method: "POST", body: JSON.stringify(input) }),
  generateCfpBracket: (input: { guildId: string; seeds?: Array<{ seed: number; teamId: string }> }) =>
    recApiFetch<import("../types/api.js").CfpPostseasonState>("/v1/schedule/cfp/generate", { method: "POST", body: JSON.stringify(input) }),
  listHeismanCandidates: (guildId: string) =>
    recApiFetch<import("../types/api.js").HeismanRaceState>("/v1/heisman/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  addHeismanCandidate: (input: { guildId: string; playerName: string; teamId?: string | null }) =>
    recApiFetch<import("../types/api.js").HeismanRaceState>("/v1/heisman/add", { method: "POST", body: JSON.stringify(input) }),
  removeHeismanCandidate: (input: { guildId: string; candidateId: string }) =>
    recApiFetch<import("../types/api.js").HeismanRaceState>("/v1/heisman/remove", { method: "POST", body: JSON.stringify(input) }),
  awardHeismanWinner: (input: { guildId: string; candidateId: string }) =>
    recApiFetch<import("../types/api.js").HeismanRaceState>("/v1/heisman/award", { method: "POST", body: JSON.stringify(input) }),
  setGameRivalry: (input: Record<string, unknown>) =>
    recApiFetch<{ enabled: boolean }>(REC_API_ROUTES.setGameRivalry, { method: "POST", body: JSON.stringify(input) }),
  getTeamManagementSummary: (guildId: string) =>
    recApiFetch<TeamManagementSummary>(REC_API_ROUTES.teamManagementSummary, { method: "POST", body: JSON.stringify({ guildId }) }),
  getLinkedRoster: (guildId: string) =>
    recApiFetch<{ entries: LinkedRosterEntry[] }>(REC_API_ROUTES.linkedRoster, { method: "POST", body: JSON.stringify({ guildId }) }),

  // League header (AppShell)
  getLeagueHeaderSummary: (guildId: string) =>
    recApiFetch<LeagueHeaderSummary>(REC_API_ROUTES.leagueHeaderSummary, { method: "POST", body: JSON.stringify({ guildId }) }),

  // Team ownership
  listLinkedUsersTeams: (guildId: string) => recApiFetch<LinkedTeamsResponse>(REC_API_ROUTES.linkedUsersTeams(guildId)),
  getTeamLinkMatrix: (guildId: string) => recApiFetch<TeamLinkMatrix>(`/v1/team-ownership/${guildId}/matrix`),
  listOpenTeams: (guildId: string) => recApiFetch<OpenTeamsResponse>(REC_API_ROUTES.openTeams(guildId)),
  listLeagueIdentities: (guildId: string) => recApiFetch<LeagueIdentitiesResponse>(`/v1/guilds/${guildId}/identities`),
  refreshBadgeBaselines: (guildId: string) => recApiFetch<{ ok: boolean; usersUpdated: number }>(`/v1/guilds/${guildId}/badges/refresh-baselines`, { method: "POST", body: JSON.stringify({}) }),
  getDefenseNicknameStatus: (input: { guildId: string; discordId: string }) =>
    recApiFetch<{ teamId: string; nickname: string | null; needsName: boolean } | null>("/v1/league-week/defense-nickname/status", { method: "POST", body: JSON.stringify(input) }),
  setDefenseNickname: (input: { guildId: string; discordId: string; teamId: string; nickname: string }) =>
    recApiFetch<{ nickname: string }>("/v1/league-week/defense-nickname", { method: "POST", body: JSON.stringify(input) }),
  getMyEosPayoutProgress: (input: { guildId: string; discordId: string }) =>
    recApiFetch<MyEosPayoutProgress>("/v1/league-week/eos-payouts/my-progress", { method: "POST", body: JSON.stringify(input) }),
  getEosAwardVotingBlock: (input: { guildId: string; discordId: string }) =>
    recApiFetch<{ polls: EosAwardVotingPoll[]; hasVotedAll: boolean }>("/v1/league-week/eos-awards/voting-block", { method: "POST", body: JSON.stringify(input) }),
  castEosAwardVote: (input: { guildId: string; discordId: string; pollId: string; nomineeUserId: string }) =>
    recApiFetch<{ ok: true }>("/v1/league-week/eos-awards/vote", { method: "POST", body: JSON.stringify(input) }),
  getEosBallotSession: (input: { guildId: string; discordId: string }) =>
    recApiFetch<EosBallotSessionInfo | null>("/v1/league-week/eos-awards/ballot-session", { method: "POST", body: JSON.stringify(input) }),
  advanceEosBallotSession: (input: { guildId: string; discordId: string; pollId: string }) =>
    recApiFetch<{ ok: true }>("/v1/league-week/eos-awards/ballot-session/advance", { method: "POST", body: JSON.stringify(input) }),
  submitEosBallot: (input: { guildId: string; discordId: string }) =>
    recApiFetch<{ ok: true }>("/v1/league-week/eos-awards/ballot-session/submit", { method: "POST", body: JSON.stringify(input) }),
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
  createMyPurchase: (input: { guildId: string; purchaseType: string; details: Record<string, unknown>; idempotencyKey?: string }) =>
    recApiFetch<any>("/v1/purchases/create", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  getStorePurchaseContext: (guildId: string) =>
    recApiFetch<import("../types/api.js").StorePurchaseContext>("/v1/purchases/store-context", { method: "POST", body: JSON.stringify({ guildId }) }),
  listHubLegends: (guildId: string) =>
    recApiFetch<{ legends: import("../types/api.js").LegendCatalogEntry[] }>("/v1/legends/catalog", { method: "POST", body: JSON.stringify({ guildId }) }),
  listHubLegendAvailability: (guildId: string) =>
    recApiFetch<{ soldLegendIds: string[]; sold: import("../types/api.js").LegendAvailabilityEntry[] }>("/v1/legends/availability", { method: "POST", body: JSON.stringify({ guildId }) }),
  purchaseHubLegend: (input: { guildId: string; legendId: string; replacementPlayerId?: string | null }) =>
    recApiFetch<any>("/v1/legends/purchase", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  cancelHubLegend: (input: { guildId: string; legendId: string }) =>
    recApiFetch<{ ok: true; refunded: number }>("/v1/legends/cancel", { method: "POST", body: JSON.stringify({ ...input, discordId: "web-dashboard" }) }),
  correctBoxScore: (input: { submissionId: string; field: string; team1?: string | null; team2?: string | null; gameId?: string | null }) =>
    recApiFetch<BoxScoreSubmissionDetail>("/v1/box-score/correct", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  appendBoxScoreImageCommissioner: (input: { submissionId: string; imageUrl: string }) =>
    recApiFetch<{ submissionId: string; imageStorageUrl: string | null; imageCount: number }>("/v1/box-score/append-image-commissioner", { method: "POST", body: JSON.stringify(input) }),

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
  getAssignableBoxScoreStats: (input: { guildId: string; submissionId: string }) =>
    recApiFetch<AssignableBoxScoreStats>("/v1/box-score/assignable-stats", { method: "POST", body: JSON.stringify(input) }),
  assignBoxScoreStatsToPlayer: (input: { guildId: string; submissionId: string; category: "passing" | "rushing"; rosterPlayerId: string }) =>
    recApiFetch<{ tagId: string }>("/v1/box-score/assign-player-stats", { method: "POST", body: JSON.stringify(input) }),
  assignBoxScoreStatAllocations: (input: { guildId: string; submissionId: string; category: "passing" | "rushing"; allocations: Array<{ rosterPlayerId: string; stats: Record<string, number> }> }) =>
    recApiFetch<{ tagIds: string[] }>("/v1/box-score/assign-player-stat-allocations", { method: "POST", body: JSON.stringify(input) }),
  assignTurnoverToPlayer: (input: { guildId: string; submissionId: string; kind: TurnoverKind; rosterPlayerId: string }) =>
    recApiFetch<{ tagId: string }>("/v1/box-score/assign-turnover", { method: "POST", body: JSON.stringify(input) }),

  // Manual final-score entry (schedule builder)
  recordManualScore: (input: { guildId: string; gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null; manualStats?: { home?: Record<string, unknown>; away?: Record<string, unknown> }; performanceTags?: { home?: PerformanceTag[]; away?: PerformanceTag[] } }) =>
    recApiFetch<ManualScoreRecordResult>("/v1/league-week/manual-scores/record", { method: "POST", body: JSON.stringify(input) }),

  // Players to Watch (per-team persistent list, selectable when tagging a game result)
  listWatchedPlayers: (guildId: string, teamId: string) =>
    recApiFetch<{ players: WatchedPlayer[] }>("/v1/watched-players/list", { method: "POST", body: JSON.stringify({ guildId, teamId }) }),
  listMyWatchedPlayers: (input: { guildId: string; discordId?: string }) =>
    recApiFetch<{ players: WatchedPlayer[] }>("/v1/watched-players/my-list", { method: "POST", body: JSON.stringify(input) }),
  submitPlayerStatLine: (input: { guildId: string; discordId?: string; playerName: string; category: string; statLines: Array<{ statKey: string; label: string; value: number }> }) =>
    recApiFetch<{ ok: true }>("/v1/watched-players/submit-stat-line", { method: "POST", body: JSON.stringify(input) }),
  createWatchedPlayer: (input: { guildId: string; teamId: string; playerName: string; position: string; classYear?: WatchedPlayer["classYear"] }) =>
    recApiFetch<{ player: WatchedPlayer }>("/v1/watched-players/create", { method: "POST", body: JSON.stringify(input) }),
  updateWatchedPlayer: (input: { guildId: string; id: string; playerName: string; position: string; classYear?: WatchedPlayer["classYear"] }) =>
    recApiFetch<{ player: WatchedPlayer }>("/v1/watched-players/update", { method: "POST", body: JSON.stringify(input) }),
  removeWatchedPlayer: (guildId: string, id: string) =>
    recApiFetch<{ removed: true }>("/v1/watched-players/remove", { method: "POST", body: JSON.stringify({ guildId, id }) }),
  createMyWatchedPlayer: (input: { guildId: string; discordId?: string; playerName: string; position: string; classYear?: WatchedPlayer["classYear"] }) =>
    recApiFetch<{ player: WatchedPlayer }>("/v1/watched-players/create-mine", { method: "POST", body: JSON.stringify(input) }),
  removeMyWatchedPlayer: (input: { guildId: string; discordId?: string; id: string }) =>
    recApiFetch<{ removed: true }>("/v1/watched-players/remove-mine", { method: "POST", body: JSON.stringify(input) }),
  listPlayerStatSubmissions: (guildId:string) => recApiFetch<{submissions:PlayerStatSubmission[]}>("/v1/player-stats/submissions/list",{method:"POST",body:JSON.stringify({guildId})}),
  updatePlayerStatSubmission: (input:{guildId:string;id:string;playerName?:string;status?:"submitted"|"approved"|"rejected";lines?:Array<{category:string;stats:Record<string,number>}>}) => recApiFetch<{updated:true}>("/v1/player-stats/submissions/update",{method:"POST",body:JSON.stringify(input)}),
  removePlayerStatSubmission: (guildId:string,id:string) => recApiFetch<{removed:true}>("/v1/player-stats/submissions/remove",{method:"POST",body:JSON.stringify({guildId,id})}),

  // Recruiting tracker
  listRecruits: (guildId: string) =>
    recApiFetch<{ recruits: Recruit[] }>("/v1/recruiting/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  createRecruit: (input: { guildId: string; playerName: string; position: string; homeCity?: string | null; homeState?: string | null; starRating: number; heightInches?: number | null; weightLbs?: number | null }) =>
    recApiFetch<{ recruit: Recruit }>("/v1/recruiting/create", { method: "POST", body: JSON.stringify(input) }),
  listRecruitingTeams: (guildId: string) =>
    recApiFetch<Array<{ id: string; name: string; abbreviation: string }>>("/v1/recruiting/teams", { method: "POST", body: JSON.stringify({ guildId }) }),
  listRecruitingBoard: (input: { guildId: string; teamId?: string }) =>
    recApiFetch<{ recruits: Recruit[] }>("/v1/recruiting/board/list", { method: "POST", body: JSON.stringify(input) }),
  addRecruitToBoard: (input: { guildId: string; recruitId: string }) =>
    recApiFetch<{ ok: true }>("/v1/recruiting/board/add", { method: "POST", body: JSON.stringify(input) }),
  removeRecruitFromBoard: (input: { guildId: string; recruitId: string }) =>
    recApiFetch<{ ok: true }>("/v1/recruiting/board/remove", { method: "POST", body: JSON.stringify(input) }),
  updateRecruitStatus: (input: { guildId: string; id: string; status: RecruitStatus; committedTeamId?: string | null; committedTeamExternal?: string | null; commitDate?: string | null }) =>
    recApiFetch<{ recruit: Recruit }>("/v1/recruiting/update-status", { method: "POST", body: JSON.stringify(input) }),
  updateRecruitDetails: (input: { guildId: string; id: string; playerName: string; position: string; starRating: number; homeCity?: string | null; homeState?: string | null }) =>
    recApiFetch<{ recruit: Recruit }>("/v1/recruiting/update-details", { method: "POST", body: JSON.stringify(input) }),
  deleteRecruit: (guildId: string, id: string) =>
    recApiFetch<{ deleted: true }>("/v1/recruiting/delete", { method: "POST", body: JSON.stringify({ guildId, id }) }),
  submitRecruitCommit: (input: { guildId: string; discordId?: string; playerName: string; position: string; starRating: number; homeCity: string; homeState: string }) =>
    recApiFetch<{ recruit: Recruit }>("/v1/recruiting/submit-commit", { method: "POST", body: JSON.stringify(input) }),

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
  getCommissionerPendingSummary: (guildId: string, discordId: string, leagueId: string) =>
    recApiFetch<{ summary: CommissionerPendingSummary | null }>("/v1/notifications/pending-summary", { method: "POST", body: JSON.stringify({ guildId, discordId, leagueId }) }),
  markCommissionerLeagueViewed: (guildId: string, discordId: string, leagueId: string) =>
    recApiFetch<{ ok: true }>("/v1/notifications/mark-viewed", { method: "POST", body: JSON.stringify({ guildId, discordId, leagueId }) }),
  markCommissionerInboxItemHandled: (input: { guildId: string; inboxId: string }) =>
    recApiFetch<{ ok: true }>("/v1/notifications/mark-handled", { method: "POST", body: JSON.stringify(input) }),
  addCaseMemo: (input: { guildId: string; inboxId: string; memo: string }) =>
    recApiFetch<{ ok: true }>("/v1/notifications/case/memo", { method: "POST", body: JSON.stringify(input) }),
  listCaseEvents: (input: { guildId: string; inboxId: string }) =>
    recApiFetch<{ events: import("../types/api.js").CommissionerCaseEvent[] }>("/v1/notifications/case/events", { method: "POST", body: JSON.stringify(input) }),
  linkCaseToVotingTopic: (input: { guildId: string; inboxId: string; topicId: string }) =>
    recApiFetch<{ ok: true }>("/v1/notifications/case/link-vote", { method: "POST", body: JSON.stringify(input) }),
  setCaseAwaitingUserResponse: (input: { guildId: string; inboxId: string; awaiting: boolean }) =>
    recApiFetch<{ ok: true }>("/v1/notifications/case/awaiting-user", { method: "POST", body: JSON.stringify(input) }),

  // Notification detail/resolve actions — reviewedBy/loggedBy/reviewer placeholders are
  // required by each schema but overridden server-side from the session for browser calls,
  // same convention as reviewBoxScore above.
  reviewPurchase: (input: { guildId: string; leagueId?: string; purchaseId: string; action: "approve" | "deny"; deniedReason?: string; finalReplaceTarget?: { position: string; firstName: string; lastName: string } | null }) =>
    recApiFetch<unknown>("/v1/purchases/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  reviewHighlight: (input: { guildId: string; leagueId?: string; reviewId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/highlights/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  getHighlightReviewDetail: (guildId: string, reviewId: string) =>
    recApiFetch<HighlightReviewDetail>("/v1/highlights/review-detail", { method: "POST", body: JSON.stringify({ guildId, reviewId }) }),
  reviewGameOfYear: (input: { guildId: string; leagueId?: string; reviewId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/highlights/game-of-the-year/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  reviewStream: (input: { guildId: string; leagueId?: string; reviewId: string; action: "approve" | "deny"; deniedReason?: string }) =>
    recApiFetch<unknown>("/v1/streams/review", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  approveTeamRequest: (input: { guildId: string; leagueId?: string; requestId: string }) =>
    recApiFetch<unknown>("/v1/team-requests/approve", { method: "POST", body: JSON.stringify({ ...input, reviewerDiscordId: "web-dashboard" }) }),
  rejectTeamRequest: (input: { guildId: string; leagueId?: string; requestId: string }) =>
    recApiFetch<unknown>("/v1/team-requests/reject", { method: "POST", body: JSON.stringify({ ...input, reviewerDiscordId: "web-dashboard" }) }),
  settleWager: (input: { guildId: string; leagueId?: string; wagerId: string }) =>
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
  setMemberRole: (input: { guildId: string; discordId: string; roleKey: RoleMgmtRoleKey }) =>
    recApiFetch<{ ok: true; roleKey: RoleMgmtRoleKey }>("/v1/roles/set", { method: "POST", body: JSON.stringify(input) }),

  // Settings (Phase 2)
  getServerChannels: (guildId: string) => recApiFetch<{ channels: Array<{ id: string; name: string; type: "text" | "category" }>; routes: Record<string, string | null> }>("/v1/server-config/channels", { method: "POST", body: JSON.stringify({ guildId }) }),
  createServerChannel: (input: { guildId: string; routeKey: string; name: string; type: "text" | "category"; templateChannelId?: string | null }) => recApiFetch<{ channel: { id: string; name: string; type: "text" | "category" } }>("/v1/server-config/channels/create", { method: "POST", body: JSON.stringify(input) }),
  saveServerChannels: (input: Record<string, string | null> & { guildId: string }) => recApiFetch<unknown>("/v1/economy/config/set", { method: "POST", body: JSON.stringify(input) }),
  refreshRecGuide: (guildId: string) => recApiFetch<{ posted: number; channelId: string }>("/v1/server-config/rec-guide/refresh", { method: "POST", body: JSON.stringify({ guildId }) }),
  getLeagueSettingsDraft: (guildId: string) =>
    recApiFetch<{ draft: LeagueSettingsDraft }>("/v1/setup/league/config", { method: "POST", body: JSON.stringify({ guildId }) }),
  getLeagueRulesDraft: (guildId: string) =>
    recApiFetch<{ draft: LeagueSettingsDraft }>("/v1/setup/league/rules", { method: "POST", body: JSON.stringify({ guildId }) }),
  updateLeagueSettings: (draft: LeagueSettingsDraft) =>
    recApiFetch<unknown>("/v1/setup/league/config/update", { method: "POST", body: JSON.stringify(draft) }),
  listModeration: (guildId: string) =>
    recApiFetch<any>("/v1/moderation/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  listModerationTargets: (guildId: string) =>
    recApiFetch<any>("/v1/moderation/targets", { method: "POST", body: JSON.stringify({ guildId }) }),
  createModerationBan: (input: { guildId: string; target: string; scope: "league" | "owner_all_leagues"; reason: string; expiresAt?: string | null }) =>
    recApiFetch<unknown>("/v1/moderation/ban", { method: "POST", body: JSON.stringify(input) }),
  liftModerationBan: (input: { guildId: string; banId: string }) =>
    recApiFetch<unknown>("/v1/moderation/ban/lift", { method: "POST", body: JSON.stringify(input) }),
  createModerationRestriction: (input: { guildId: string; target: string; restrictionType: "wagers" | "highlights"; reason: string; expiresAt?: string | null }) =>
    recApiFetch<unknown>("/v1/moderation/restrict", { method: "POST", body: JSON.stringify(input) }),
  kickModerationUser: (input: { guildId: string; target: string; scope: "league" | "server" | "both"; reason: string }) =>
    recApiFetch<unknown>("/v1/moderation/kick", { method: "POST", body: JSON.stringify(input) }),
  liftModerationRestriction: (input: { guildId: string; restrictionId: string }) =>
    recApiFetch<unknown>("/v1/moderation/restrict/lift", { method: "POST", body: JSON.stringify(input) }),
  listSuspensionPlayers: (guildId: string) =>
    recApiFetch<{ players: Array<{ id: string; full_name: string; position: string; team_name: string; team_abbreviation: string | null }> }>("/v1/moderation/suspension-players", { method: "POST", body: JSON.stringify({ guildId }) }),
  suspendLeagueTargets: (input: { guildId: string; targetType: "user" | "player"; target?: string; playerIds?: string[]; startWeek: number; weekCount: number; reason: string }) =>
    recApiFetch<unknown>("/v1/moderation/suspend", { method: "POST", body: JSON.stringify(input) }),
  liftModerationSuspension: (input: { guildId: string; suspensionId: string }) =>
    recApiFetch<unknown>("/v1/moderation/suspend/lift", { method: "POST", body: JSON.stringify(input) }),

  // First-Time Setup (Phase 2) — omitted fields fall back to CreateLeagueSchema's Zod
  // defaults server-side, so a minimal payload here is intentional, not a shortcut.
  createLeague: (input: { guildId: string; name: string; game: string; leagueType?: string; activeRostersEnabled?: boolean; trackRostersEnabled?: boolean }) =>
    recApiFetch<{ league: { id: string; name: string }; defaultTeams: unknown[] }>("/v1/setup/league/create", { method: "POST", body: JSON.stringify(input) }),

  // Advance — the web is now the sole advance surface (there is no Discord advance wizard
  // any more). completeAdvanceWeek triggers every side effect the old wizard used to:
  // GOTW settlement, EOS auto-trigger, league inbox notifications, and the
  // @everyone announcement, all server-side via Discord's REST API.
  getAdvanceWeekGames: (guildId: string) =>
    recApiFetch<AdvanceWeekGames>("/v1/league-week/advance-games", { method: "POST", body: JSON.stringify({ guildId }) }),
  notifyMissingBoxScore: (input: { guildId: string; gameId: string; target: "home" | "away" | "both" }) =>
    recApiFetch<{ ok: true; notifiedUserIds: string[] }>("/v1/league-week/notify-missing", { method: "POST", body: JSON.stringify(input) }),
  completeAdvanceWeek: (input: { guildId: string; nextWeekNumber: number; nextSeasonStage: string; results: AdvanceResultInput[]; nextGotwGameId?: string | null; nextAdvance?: { year: number; month: number; day: number; hour: number; minute: number; tzLabel: string } | null }) =>
    recApiFetch<{ nextAdvanceLabel: string; discord?: { announcementPosted: boolean; error?: string } | null; gameChannels?: { created: unknown[]; deleted: number; eligible: number; error?: string } }>("/v1/league-week/advance-complete", { method: "POST", body: JSON.stringify({ ...input, advancedByDiscordId: "web-dashboard" }) }),
  getAdvanceJumpTargets: (guildId: string) =>
    recApiFetch<{ currentWeek: number; currentStage: string; currentLabel: string; targets: Array<{ weekNumber: number; seasonStage: string; label: string }> }>("/v1/league-week/advance-jump/targets", { method: "POST", body: JSON.stringify({ guildId }) }),
  getAdvanceJumpPlan: (input: { guildId: string; targetWeekNumber: number; targetSeasonStage: string }) =>
    recApiFetch<{ steps: Array<{ weekNumber: number; seasonStage: string; label: string; gamesNeedingInput: AdvanceWeekGames["gamesNeedingInput"] }>; targetLabel: string; reachable: boolean }>("/v1/league-week/advance-jump/plan", { method: "POST", body: JSON.stringify(input) }),
  completeAdvanceJump: (input: { guildId: string; targetWeekNumber: number; targetSeasonStage: string; results: AdvanceResultInput[] }) =>
    recApiFetch<{ landedLabel: string; steps: number; discord?: { announcementPosted: boolean; error?: string } | null }>("/v1/league-week/advance-jump/complete", { method: "POST", body: JSON.stringify({ ...input, advancedByDiscordId: "web-dashboard" }) }),
  getDivisionWinnerOptions: (guildId: string) =>
    recApiFetch<DivisionWinnerOptions>("/v1/league-week/division-winner-options", { method: "POST", body: JSON.stringify({ guildId }) }),
  saveDivisionWinners: (input: { guildId: string; seasonNumber: number; winners: Array<{ divisionKey: string; teamId: string }> }) =>
    recApiFetch<unknown>("/v1/league-week/division-winners", { method: "POST", body: JSON.stringify({ ...input, selectedByDiscordId: "web-dashboard" }) }),
  setNextAdvanceTime: (input: { guildId: string; year: number; month: number; day: number; hour: number; minute: number; tzLabel: string }) =>
    recApiFetch<unknown>("/v1/league-week/set-next-advance", { method: "POST", body: JSON.stringify(input) }),
  setGamePostseasonFlags: (input: { guildId: string; gameId: string; isBowlGame: boolean; isNationalChampionship: boolean }) =>
    recApiFetch<unknown>("/v1/league-week/games/postseason-flags", { method: "POST", body: JSON.stringify(input) }),

  // Game channels — creates (and replaces last week's) Discord game channels for the
  // current week's H2H matchups.
  createGameChannelsForCurrentWeek: (guildId: string) =>
    recApiFetch<{ created: Array<{ gameId: string; discordChannelId: string; name: string }>; deleted: number; eligible: number }>("/v1/game-channels/create-current-week", { method: "POST", body: JSON.stringify({ guildId }) }),
  // Fill-only repair: only creates a channel for a current-week H2H matchup missing one —
  // never touches an existing tracked channel.
  repairGameChannelsForCurrentWeek: (guildId: string) =>
    recApiFetch<{ created: Array<{ gameId: string; discordChannelId: string; name: string }>; skipped: number; eligible: number }>("/v1/game-channels/repair-current-week", { method: "POST", body: JSON.stringify({ guildId }) }),

  // GOTW — commissioner assigns a game from League Mgmt; voting/closing live on the Hub
  // matchup page.
  listGotwPollsForWeek: (input: { guildId: string; weekNumber: number }) =>
    recApiFetch<{ polls: GotwPollStatus[] }>("/v1/gotw/poll/active-all", { method: "POST", body: JSON.stringify(input) }),
  assignGotwPoll: (input: { guildId: string; gameId: string; awayTeamId: string; homeTeamId: string; awayUserId?: string | null; homeUserId?: string | null; awayTeamName: string; homeTeamName: string; weekNumber: number }) =>
    recApiFetch<{ pollId: string }>("/v1/gotw/poll/create", { method: "POST", body: JSON.stringify(input) }),
  // Score-ranked GOTW candidates for the advance flow (top flagged `recommended`).
  getGotwCandidates: (input: { guildId: string; weekNumber: number }) =>
    recApiFetch<{ candidates: GotwCandidate[] }>("/v1/league-week/gotw-candidates", { method: "POST", body: JSON.stringify(input) }),

  // EOS Payouts — Pending Payouts inbox.
  listPendingEosLedgers: (guildId: string) =>
    recApiFetch<PendingEosLedgers>("/v1/league-week/eos-payouts/pending", { method: "POST", body: JSON.stringify({ guildId }) }),
  adjustEosPayoutItem: (input: { guildId: string; itemId: string; tier: RecPayoutTier | null }) =>
    recApiFetch<{ item: unknown }>("/v1/league-week/eos-payouts/adjust-item", { method: "POST", body: JSON.stringify(input) }),
  reviewEosLedger: (input: { guildId: string; batchId: string; userId: string; action: "approve" | "deny"; deniedReason?: string | null }) =>
    recApiFetch<{ totalAmount: number }>("/v1/league-week/eos-payouts/review-user", { method: "POST", body: JSON.stringify({ ...input, reviewedByDiscordId: "web-dashboard" }) }),
  wipeAndRerunEosPayouts: (input: { guildId: string; reason: string }) =>
    recApiFetch<unknown>("/v1/league-week/eos-payouts/wipe-rerun", { method: "POST", body: JSON.stringify(input) }),

  // CFB baseline roster seed + maintenance (backlog #41)
  getCfbRosterSeedStatus: (guildId: string) =>
    recApiFetch<CfbRosterSeedStatus>("/v1/cfb-baseline/league-status", { method: "POST", body: JSON.stringify({ guildId }) }),
  applyCfbBaseline: (guildId: string) =>
    recApiFetch<CfbBaselineApplyResponse>("/v1/cfb-baseline/apply", { method: "POST", body: JSON.stringify({ guildId }) }),
  rollForwardCfbRoster: (guildId: string) =>
    recApiFetch<CfbRollForwardResponse>("/v1/cfb-baseline/roll-forward", { method: "POST", body: JSON.stringify({ guildId }) }),

  // Commissioner Chat + Voting
  listChatMessages: (input: { guildId: string; sinceIso?: string | null }) =>
    recApiFetch<{ messages: ChatMessage[] }>("/v1/commissioner-chat/messages/list", { method: "POST", body: JSON.stringify(input) }),
  postChatMessage: (input: { guildId: string; body: string; replyToMessageId?: string | null }) =>
    recApiFetch<{ message: ChatMessage }>("/v1/commissioner-chat/messages/post", { method: "POST", body: JSON.stringify(input) }),
  editChatMessage: (input: { guildId: string; messageId: string; body: string }) =>
    recApiFetch<{ message: ChatMessage }>("/v1/commissioner-chat/messages/edit", { method: "POST", body: JSON.stringify(input) }),
  deleteChatMessage: (input: { guildId: string; messageId: string }) =>
    recApiFetch<{ ok: true }>("/v1/commissioner-chat/messages/delete", { method: "POST", body: JSON.stringify(input) }),
  listChatTopics: (guildId: string) =>
    recApiFetch<{ topics: ChatTopic[] }>("/v1/commissioner-chat/topics/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  createChatTopic: (input: { guildId: string; title: string; description?: string | null; options: string[]; closesAt?: string | null; audience?: "commissioners" | "league" }) =>
    recApiFetch<{ topic: ChatTopic }>("/v1/commissioner-chat/topics/create", { method: "POST", body: JSON.stringify(input) }),
  voteOnChatTopic: (input: { guildId: string; topicId: string; optionIndex: number }) =>
    recApiFetch<{ ok: true }>("/v1/commissioner-chat/topics/vote", { method: "POST", body: JSON.stringify(input) }),
  listPublicPolls: (input: { guildId: string; discordId: string }) =>
    recApiFetch<{ polls: PublicPoll[] }>("/v1/commissioner-chat/topics/public-list", { method: "POST", body: JSON.stringify(input) }),
  voteOnPublicPoll: (input: { guildId: string; topicId: string; optionIndex: number }) =>
    recApiFetch<{ ok: true }>("/v1/commissioner-chat/topics/public-vote", { method: "POST", body: JSON.stringify(input) }),
  closeChatTopic: (input: { guildId: string; topicId: string }) =>
    recApiFetch<{ ok: true }>("/v1/commissioner-chat/topics/close", { method: "POST", body: JSON.stringify(input) }),
  getMentionableCommissioners: (guildId: string) =>
    recApiFetch<MentionableList>(REC_API_ROUTES.commissionerChatMentionable, { method: "POST", body: JSON.stringify({ guildId }) }),

  // League Chat + Game Chat (Campus Buzz "Chat" tab)
  listLeagueChatMessages: (input: { guildId: string; sinceIso?: string | null }) =>
    recApiFetch<{ messages: LeagueChatMessage[] }>("/v1/league-chat/messages/list", { method: "POST", body: JSON.stringify(input) }),
  postLeagueChatMessage: (input: { guildId: string; body: string; replyToMessageId?: string | null }) =>
    recApiFetch<{ message: LeagueChatMessage }>("/v1/league-chat/messages/post", { method: "POST", body: JSON.stringify(input) }),
  editLeagueChatMessage: (input: { guildId: string; messageId: string; body: string }) =>
    recApiFetch<{ message: LeagueChatMessage }>("/v1/league-chat/messages/edit", { method: "POST", body: JSON.stringify(input) }),
  deleteLeagueChatMessage: (input: { guildId: string; messageId: string }) =>
    recApiFetch<{ ok: true }>("/v1/league-chat/messages/delete", { method: "POST", body: JSON.stringify(input) }),
  listLeagueMembersForChat: (guildId: string) =>
    recApiFetch<{ members: LeagueChatMember[] }>("/v1/league-chat/members/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  sendLeagueChatHeartbeat: (guildId: string) =>
    recApiFetch<{ ok: true }>("/v1/league-chat/heartbeat", { method: "POST", body: JSON.stringify({ guildId }) }),
  listGameChatChannels: (guildId: string) =>
    recApiFetch<{ channels: GameChatChannel[] }>("/v1/game-chat/channels/list", { method: "POST", body: JSON.stringify({ guildId }) }),
  listGameChatMessages: (input: { guildId: string; gameChannelId: string }) =>
    recApiFetch<{ messages: GameChatMessage[] }>("/v1/game-chat/messages/list", { method: "POST", body: JSON.stringify(input) }),
  postGameChatMessage: (input: { guildId: string; gameChannelId: string; body: string; replyToMessageId?: string | null }) =>
    recApiFetch<{ message: GameChatMessage }>("/v1/game-chat/messages/post", { method: "POST", body: JSON.stringify(input) }),
  editGameChatMessage: (input: { guildId: string; messageId: string; body: string }) =>
    recApiFetch<{ message: GameChatMessage }>("/v1/game-chat/messages/edit", { method: "POST", body: JSON.stringify(input) }),
  deleteGameChatMessage: (input: { guildId: string; messageId: string }) =>
    recApiFetch<{ ok: true }>("/v1/game-chat/messages/delete", { method: "POST", body: JSON.stringify(input) }),

  // Universal Chat Drawer — aggregated channel list + unread state, spanning league/game/commissioner chat.
  listChatChannels: (guildId: string) =>
    recApiFetch<{ channels: ChatChannelSummary[]; canAccessCommissionerChat: boolean }>(REC_API_ROUTES.chatChannelsList, {
      method: "POST",
      body: JSON.stringify({ guildId }),
    }),
  markChatChannelRead: (input: { guildId: string } & ChatMarkReadInput) =>
    recApiFetch<{ ok: true }>(REC_API_ROUTES.chatChannelsMarkRead, { method: "POST", body: JSON.stringify(input) }),
  listChatReactions: (input: { guildId: string; channelType: ChatChannelType; messageIds: string[] }) =>
    recApiFetch<{ reactions: ChatReactionSummary[] }>("/v1/chat/reactions/list", { method: "POST", body: JSON.stringify(input) }),
  toggleChatReaction: (input: { guildId: string; channelType: ChatChannelType; messageId: string; emojiKey: string }) =>
    recApiFetch<{ reacted: boolean }>("/v1/chat/reactions/toggle", { method: "POST", body: JSON.stringify(input) }),
  uploadChatAttachment: (guildId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return recApiFetch<{ storageKey: string; url: string; mimeType: string; filename: string | null; sizeBytes: number }>(
      `/v1/chat/attachments/upload?guildId=${encodeURIComponent(guildId)}`,
      { method: "POST", body: formData },
    );
  },
  attachChatFile: (input: { guildId: string; channelType: ChatChannelType; messageId: string; storageKey: string; url: string; mimeType: string; filename?: string | null; sizeBytes?: number | null }) =>
    recApiFetch<{ attachment: ChatAttachment }>("/v1/chat/attachments/attach", { method: "POST", body: JSON.stringify(input) }),
  listChatAttachments: (input: { guildId: string; channelType: ChatChannelType; messageIds: string[] }) =>
    recApiFetch<{ attachments: ChatAttachment[] }>("/v1/chat/attachments/list", { method: "POST", body: JSON.stringify(input) }),

  getCustomPlayerConfig: (guildId: string) => recApiFetch<any>("/v1/custom-players/config", { method: "POST", body: JSON.stringify({ guildId }) }),
  getCustomPlayerDraft: (guildId: string) => recApiFetch<any>("/v1/custom-players/draft/get", { method: "POST", body: JSON.stringify({ guildId }) }),
  saveCustomPlayerDraft: (input: Record<string, unknown>) => recApiFetch<any>("/v1/custom-players/draft/save", { method: "POST", body: JSON.stringify(input) }),
  cancelCustomPlayerDraft: (guildId: string) => recApiFetch<any>("/v1/custom-players/draft/cancel", { method: "POST", body: JSON.stringify({ guildId }) }),
  generateCustomPlayerName: (guildId: string, seed: string) => recApiFetch<{ firstName: string; lastName: string; fullName: string }>("/v1/custom-players/name", { method: "POST", body: JSON.stringify({ guildId, seed }) }),
  submitCustomPlayer: (input: Record<string, unknown>) => recApiFetch<any>("/v1/custom-players/submit", { method: "POST", body: JSON.stringify(input) }),
  listCustomPlayerBuilds: (guildId: string, manage = false) => recApiFetch<any>("/v1/custom-players/list", { method: "POST", body: JSON.stringify({ guildId, manage }) }),
  reviewCustomPlayer: (input: { guildId: string; buildId: string; action: "approve" | "reject"; note?: string; adjustments?: Record<string, unknown> }) => recApiFetch<any>("/v1/custom-players/review", { method: "POST", body: JSON.stringify(input) }),

  // Home page's weekly H2H panel
  getWeeklyH2hGames: (guildId: string) =>
    recApiFetch<WeeklyH2hGamesResponse>(REC_API_ROUTES.weeklyH2hGames, { method: "POST", body: JSON.stringify({ guildId }) }),
};
