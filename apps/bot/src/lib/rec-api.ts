import { REC_API_ROUTES, type RecTeamAuthority } from "@rec/shared";
import { env } from "../config/env.js";
import type { LeagueSetupDraft } from "../ui/league-setup.js";

const REC_API_TIMEOUT_MS = 30_000;

async function recFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.REC_CORE_API_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REC_API_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "x-rec-api-key": env.REC_INTERNAL_API_KEY ?? "",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`REC API request failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export const recApi = {
  health: () => recFetch<{ ok: boolean; service: string }>(REC_API_ROUTES.health),
  mintWebSession: (input: { guildId: string; discordId: string; username: string; globalName: string | null }) =>
    recFetch<{ token: string; expiresInSeconds: number }>(REC_API_ROUTES.webSessionMint, { method: "POST", body: JSON.stringify(input) }),
  mintAppHandoff: (input: { guildId: string; discordId: string; username: string; globalName: string | null }) =>
    recFetch<{ token: string; expiresInSeconds: number }>(REC_API_ROUTES.webSessionHandoffMint, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  recordHubAnnouncement: (input: { guildId: string; title: string; body: string; discordChannelId?: string | null; discordMessageId?: string | null }) =>
    recFetch<{ recorded: boolean }>("/v1/hub/announcements/record", { method: "POST", body: JSON.stringify(input) }),
  getWallet: (discordId: string, guildId?: string) => recFetch<any>(`/v1/users/${discordId}/wallet${guildId ? `?guildId=${guildId}` : ""}`),
  transferSavings: (discordId: string, amount: number, direction: "to_savings" | "from_savings") =>
    recFetch<any>(`/v1/users/${discordId}/wallet/transfer`, { method: "POST", body: JSON.stringify({ amount, direction }) }),
  getUserSnapshot: (discordId: string, guildId: string) =>
    recFetch<any>(`/v1/users/${discordId}/snapshot?guildId=${guildId}`),
  getUserSchedule: (discordId: string, guildId: string) =>
    recFetch<any>(`/v1/users/${discordId}/schedule?guildId=${guildId}`),
  getMenuProfile: (discordId: string, guildId: string) =>
    recFetch<any>(REC_API_ROUTES.menuProfile(discordId, guildId)),
  getLeagueIdentities: (guildId: string) =>
    recFetch<any>(`/v1/guilds/${guildId}/identities`),
  getLeagueCoaches: (guildId: string) =>
    recFetch<any>(`/v1/guilds/${guildId}/coaches`),
  refreshBadgeBaselines: (guildId: string) =>
    recFetch<any>(`/v1/guilds/${guildId}/badges/refresh-baselines`, { method: "POST", body: JSON.stringify({}) }),
  getSeasonXfBadges: (guildId: string, seasonNumber?: number | null) =>
    recFetch<any>(`/v1/guilds/${guildId}/badges/xf-season${seasonNumber ? `?seasonNumber=${seasonNumber}` : ""}`),

  createLeague: (input: LeagueSetupDraft & {
    guildId: string;
    requestedByDiscordId?: string;
    serverName?: string;
  }) =>
    recFetch<any>(REC_API_ROUTES.createLeague, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getLeagueConfig: (guildId: string) =>
    recFetch<{ draft: LeagueSetupDraft }>("/v1/setup/league/config", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  updateLeagueConfig: (input: LeagueSetupDraft & { guildId: string; requestedByDiscordId?: string }) =>
    recFetch<any>("/v1/setup/league/config/update", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  deleteLeagueData: (input: { guildId: string; requestedByDiscordId?: string; confirmationText: string }) =>
    recFetch<any>("/v1/setup/league/delete", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getLeagueTeamConferences: (guildId: string) =>
    recFetch<{ teams: Array<{ abbreviation: string; name: string; conference: string }> }>(
      "/v1/setup/league/teams/conferences",
      { method: "POST", body: JSON.stringify({ guildId }) }
    ),

  updateTeamConference: (input: { guildId: string; abbreviation: string; conference: string; requestedByDiscordId?: string }) =>
    recFetch<any>("/v1/setup/league/teams/conference", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  createDefaultTeams: (guildId: string, requestedByDiscordId?: string) =>
    recFetch<any>(REC_API_ROUTES.createDefaultTeams, {
      method: "POST",
      body: JSON.stringify({ guildId, requestedByDiscordId })
    }),

  resetDefaultTeams: (guildId: string, requestedByDiscordId?: string) =>
    recFetch<any>("/v1/team-ownership/reset-default-teams", {
      method: "POST",
      body: JSON.stringify({ guildId, requestedByDiscordId })
    }),

  getLinkedUsersTeams: (guildId: string) => recFetch<any>(REC_API_ROUTES.linkedUsersTeams(guildId)),
  getOpenTeams: (guildId: string) => recFetch<any>(REC_API_ROUTES.openTeams(guildId)),

  linkUserToTeam: (input: {
    guildId: string;
    discordId: string;
    teamId: string;
    authority: RecTeamAuthority;
    requestedByDiscordId?: string;
  }) =>
    recFetch<any>(REC_API_ROUTES.linkUserToTeam, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  unlinkAllTeams: (guildId: string, requestedByDiscordId?: string) =>
    recFetch<any>("/v1/team-ownership/unlink-all", {
      method: "POST",
      body: JSON.stringify({ guildId, requestedByDiscordId })
    }),

  unlinkTeam: (input: { guildId: string; teamId: string; requestedByDiscordId?: string }) =>
    recFetch<any>("/v1/team-ownership/unlink-team", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  createCustomTeamReplacement: (input: {
    guildId: string;
    replacementTeamAbbreviation: string;
    customTeamName: string;
    customDisplayCity?: string;
    customDisplayNick?: string;
    customDisplayAbbr?: string;
    requestedByDiscordId?: string;
  }) =>
    recFetch<any>(REC_API_ROUTES.createCustomTeamReplacement, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  setEconomyConfig: (input: {
    guildId: string;
    pendingEconomyChannelId?: string;
    boxScoresChannelId?: string;
    weeklySubmissionsChannelId?: string;
    recGuideChannelId?: string;
    powerRankingsChannelId?: string;
    gameChannelsCategoryId?: string;
    streamsChannelId?: string;
    highlightsChannelId?: string;
    announcementsChannelId?: string;
    commissionerRoleId?: string;
    compCommitteeRoleId?: string;
  }) =>
    recFetch<any>("/v1/economy/config/set", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getEconomyConfig: (guildId: string) =>
    recFetch<any>("/v1/economy/config/view", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  viewLeagueWeek: (guildId: string) =>
    recFetch<any>("/v1/league-week/view", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  setLeagueWeek: (input: {
    guildId: string;
    weekNumber: number;
    seasonStage: string;
    seasonNumber?: number;
  }) =>
    recFetch<any>("/v1/league-week/set", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getAdvanceWeekGames: (guildId: string) =>
    recFetch<any>("/v1/league-week/advance-games", {
      method: "POST",
      body: JSON.stringify({ guildId }),
    }),

  createWeeklyScoreReview: (input: { guildId: string; weekNumber?: number | null; imageUrls: string[]; createdByDiscordId: string }) =>
    recFetch<any>("/v1/league-week/weekly-scores/review/create", { method: "POST", body: JSON.stringify(input) }),

  getWeeklyScoreReview: (reviewId: string) =>
    recFetch<any>("/v1/league-week/weekly-scores/review/get", { method: "POST", body: JSON.stringify({ reviewId }) }),

  correctWeeklyScoreReview: (input: { reviewId: string; gameId: string; awayScore: number | null; homeScore: number | null }) =>
    recFetch<any>("/v1/league-week/weekly-scores/review/correct", { method: "POST", body: JSON.stringify(input) }),

  approveWeeklyScoreReview: (input: { reviewId: string; loggedByDiscordId: string }) =>
    recFetch<any>("/v1/league-week/weekly-scores/review/approve", { method: "POST", body: JSON.stringify(input) }),

  cancelWeeklyScoreReview: (reviewId: string) =>
    recFetch<any>("/v1/league-week/weekly-scores/review/cancel", { method: "POST", body: JSON.stringify({ reviewId }) }),

  listManualScoreGames: (input: { guildId: string; weekNumber?: number | null }) =>
    recFetch<any>("/v1/league-week/manual-scores/games", { method: "POST", body: JSON.stringify(input) }),

  recordManualGameResult: (input: { guildId: string; gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null }) =>
    recFetch<any>("/v1/league-week/manual-scores/record", { method: "POST", body: JSON.stringify(input) }),

  completeAdvanceWeek: (input: {
    guildId: string;
    nextWeekNumber: number;
    nextSeasonStage: string;
    advancedByDiscordId: string;
    results: Array<{ gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null }>;
  }) =>
    recFetch<any>("/v1/league-week/advance-complete", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  generateAdvanceDms: (input: { guildId: string }) =>
    recFetch<any>("/v1/league-week/advance-dms", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getDivisionWinnerOptions: (guildId: string) =>
    recFetch<any>("/v1/league-week/division-winner-options", {
      method: "POST",
      body: JSON.stringify({ guildId }),
    }),

  saveDivisionWinners: (input: {
    guildId: string;
    seasonNumber: number;
    selectedByDiscordId: string;
    winners: Array<{ divisionKey: string; teamId: string }>;
  }) =>
    recFetch<any>("/v1/league-week/division-winners", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  setNextAdvance: (input: {
    guildId: string;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute?: number;
    tzLabel: string;
  }) =>
    recFetch<{ nextAdvanceAt: string; epochSeconds: number; tzLabel: string }>("/v1/league-week/set-next-advance", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listAdvanceStories: (input: { guildId: string; seasonNumber: number; weekNumber: number; includePosted?: boolean }) =>
    recFetch<any>("/v1/league-week/advance-stories", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  markAdvanceStoryPosted: (input: { guildId: string; storyId: string; channelId: string; messageId: string }) =>
    recFetch<any>("/v1/league-week/advance-stories/posted", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  prepareEosPayouts: (input: { guildId: string; requestedByDiscordId: string }) =>
    recFetch<any>("/v1/league-week/eos-payouts/prepare", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  projectEosPayouts: (input: { guildId: string }) =>
    recFetch<any>("/v1/league-week/eos-payouts/project", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  reviewEosPayout: (input: { itemId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) =>
    recFetch<any>("/v1/league-week/eos-payouts/review", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  reviewEosPayoutsForUser: (input: { batchId: string; userId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) =>
    recFetch<any>("/v1/league-week/eos-payouts/review-user", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  issueEosPayoutBatch: (input: { batchId: string; reviewedByDiscordId: string }) =>
    recFetch<any>("/v1/league-week/eos-payouts/issue-batch", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  prepareEosAwardNominees: (input: { guildId: string }) =>
    recFetch<any>("/v1/league-week/eos-awards/prepare", { method: "POST", body: JSON.stringify(input) }),

  recordEosAwardPoll: (input: { guildId: string; categoryKey: string; discordChannelId: string; discordMessageId: string; closesAt: string; nominees: any[] }) =>
    recFetch<any>("/v1/league-week/eos-awards/record-poll", { method: "POST", body: JSON.stringify(input) }),

  listOpenEosAwardPolls: () =>
    recFetch<{ polls: any[] }>("/v1/league-week/eos-awards/open", { method: "POST", body: JSON.stringify({}) }),

  cancelOpenEosAwardPolls: (input: { guildId: string }) =>
    recFetch<{ cancelled: any[] }>("/v1/league-week/eos-awards/cancel-open", { method: "POST", body: JSON.stringify(input) }),

  settleEosAwardPoll: (input: { pollId: string; voteCounts: Record<string, number>; voterDiscordIds?: Record<string, string[]>; discordMessageId?: string | null }) =>
    recFetch<any>("/v1/league-week/eos-awards/settle", { method: "POST", body: JSON.stringify(input) }),

  listSettledEosAwards: (input: { guildId: string; seasonNumber?: number | null }) =>
    recFetch<any>("/v1/league-week/eos-awards/settled", { method: "POST", body: JSON.stringify(input) }),

  listReversibleTransactions: (input: { guildId: string; discordId: string }) =>
    recFetch<any>("/v1/admin-economy/reversible-transactions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  reverseTransaction: (input: { guildId: string; discordId: string; ledgerId: string; requestedByDiscordId: string }) =>
    recFetch<any>("/v1/admin-economy/reverse-transaction", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  createGotwPoll: (input: {
    guildId: string; gameId: string; awayTeamId: string; homeTeamId: string;
    awayUserId?: string | null; homeUserId?: string | null;
    awayTeamName: string; homeTeamName: string;
    discordChannelId?: string | null; discordMessageId?: string | null;
    weekNumber: number; expiresAt?: string | null;
  }) => recFetch<any>("/v1/gotw/poll/create", { method: "POST", body: JSON.stringify(input) }),

  getActiveGotwPoll: (input: { guildId: string; weekNumber: number }) =>
    recFetch<any>("/v1/gotw/poll/active", { method: "POST", body: JSON.stringify(input) }),

  getActiveGotwPolls: (input: { guildId: string; weekNumber: number }) =>
    recFetch<{ polls: any[] }>("/v1/gotw/poll/active-all", { method: "POST", body: JSON.stringify(input) }),

  clearGotwPollsForWeek: (input: { guildId: string; weekNumber: number }) =>
    recFetch<{ cleared: number; polls: any[] }>("/v1/gotw/poll/clear-week", { method: "POST", body: JSON.stringify(input) }),

  settleGotwPoll: (input: {
    guildId: string; pollId: string; winningTeamId: string | null;
    voters: { discordId: string; userId?: string | null; selectedTeamId: string }[];
  }) => recFetch<any>("/v1/gotw/poll/settle", { method: "POST", body: JSON.stringify(input) }),

  getGotwGameResult: (input: { guildId: string; awayTeamId: string; homeTeamId: string; weekNumber: number }) =>
    recFetch<any>("/v1/gotw/poll/game-result", { method: "POST", body: JSON.stringify(input) }),

  createActiveCheck: (input: {
    guildId: string;
    discordChannelId: string;
    discordMessageId: string;
    createdByDiscordId: string;
    closesAt: string;
  }) =>
    recFetch<any>("/v1/active-checks/create", { method: "POST", body: JSON.stringify(input) }),

  listOpenActiveChecks: () =>
    recFetch<{ events: any[] }>("/v1/active-checks/open", { method: "POST", body: JSON.stringify({}) }),

  settleActiveCheck: (input: { eventId: string; activeDiscordIds: string[]; kickMeDiscordIds: string[] }) =>
    recFetch<any>("/v1/active-checks/settle", { method: "POST", body: JSON.stringify(input) }),

  getActiveCheckReview: (eventId: string) =>
    recFetch<any>("/v1/active-checks/review", { method: "POST", body: JSON.stringify({ eventId }) }),

  keepActiveCheckUsers: (input: { eventId: string; discordIds: string[] }) =>
    recFetch<any>("/v1/active-checks/keep", { method: "POST", body: JSON.stringify(input) }),

  markActiveCheckBooted: (input: { eventId: string; discordIds: string[] }) =>
    recFetch<any>("/v1/active-checks/booted", { method: "POST", body: JSON.stringify(input) }),

  markActiveCheckNeedsReview: (input: { eventId: string; reason: string }) =>
    recFetch<any>("/v1/active-checks/needs-review", { method: "POST", body: JSON.stringify(input) }),

  createTeamLinkRequest: (input: { guildId: string; discordId: string; teamId: string }) =>
    recFetch<any>("/v1/team-requests/create", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  approveTeamLinkRequest: (input: { requestId: string; reviewerDiscordId: string }) =>
    recFetch<any>("/v1/team-requests/approve", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  rejectTeamLinkRequest: (input: { requestId: string; reviewerDiscordId: string }) =>
    recFetch<any>("/v1/team-requests/reject", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  completeTeamLinkRequest: (input: {
    requestId: string;
    authority: "member" | "co_commissioner" | "commissioner";
    reviewerDiscordId: string;
  }) =>
    recFetch<any>("/v1/team-requests/complete", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  attachTeamLinkRequestMessage: (input: { requestId: string; channelId: string; messageId: string }) =>
    recFetch<any>("/v1/team-requests/attach-message", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  recordStreamPost: (input: {
    guildId: string;
    discordId: string;
    discordChannelId: string;
    discordMessageId: string;
    messageUrl?: string | null;
    content?: string | null;
    service?: string | null;
    submissionType?: "link" | "discord_live" | null;
  }) =>
    recFetch<any>("/v1/streams/post", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  reviewStreamPayout: (input: {
    reviewId: string;
    action: "approve" | "deny";
    reviewedByDiscordId: string;
    deniedReason?: string | null;
  }) =>
    recFetch<any>("/v1/streams/review", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  recordHighlightPost: (input: {
    guildId: string;
    discordId: string;
    discordChannelId: string;
    discordMessageId: string;
    messageUrl?: string | null;
    content?: string | null;
  }) =>
    recFetch<any>("/v1/highlights/post", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  reviewHighlightPayout: (input: {
    reviewId: string;
    action: "approve" | "deny";
    reviewedByDiscordId: string;
    deniedReason?: string | null;
  }) =>
    recFetch<any>("/v1/highlights/review", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  listHighlightAwardCandidates: (guildId: string) =>
    recFetch<any>("/v1/highlights/award-candidates", { method: "POST", body: JSON.stringify({ guildId }) }),

  createHighlightAwardReview: (input: {
    guildId: string;
    category: string;
    highlightPostId: string;
    voteCount: number;
    amount?: number;
  }) =>
    recFetch<any>("/v1/highlights/award-review", { method: "POST", body: JSON.stringify(input) }),

  getLeagueConferences: (guildId: string) =>
    recFetch<any>("/v1/rosters/conferences", { method: "POST", body: JSON.stringify({ guildId }) }),

  parseBoxScore: (input: {
    guildId: string;
    discordId: string;
    imageUrls: string[];
    seasonNumber?: number | null;
    weekNumber?: number | null;
    commissionerSubmission?: boolean | null;
  }) =>
    recFetch<any>("/v1/box-score/parse", { method: "POST", body: JSON.stringify(input) }),

  submitBoxScore: (input: {
    guildId: string;
    discordId: string;
    imageUrls: string[];
    discordChannelId?: string | null;
    discordMessageId?: string | null;
    extraDiscordMessageIds?: string[] | null;
    ledgerDiscordMessageId?: string | null;
    seasonNumber?: number | null;
    weekNumber?: number | null;
    expectedGameId?: string | null;
    commissionerSubmission?: boolean | null;
  }): Promise<{ jobId: string; status: string }> =>
    recFetch<{ jobId: string; status: string }>("/v1/box-score/submit", { method: "POST", body: JSON.stringify(input) }),

  // Poll a background OCR job started by submitBoxScore. Returns { status } while
  // processing, then { status: "done", result } or { status: "failed", error }.
  getBoxScoreJob: (jobId: string) =>
    recFetch<any>("/v1/box-score/job", { method: "POST", body: JSON.stringify({ jobId }) }),

  reviewBoxScore: (input: {
    submissionId: string;
    action: "approve" | "deny";
    reviewedByDiscordId: string;
    deniedReason?: string | null;
  }) =>
    recFetch<any>("/v1/box-score/review", { method: "POST", body: JSON.stringify(input) }),

  correctBoxScore: (input: {
    submissionId: string;
    reviewedByDiscordId: string;
    field: string;
    team1?: string | null;
    team2?: string | null;
    gameId?: string | null;
  }) =>
    recFetch<any>("/v1/box-score/correct", { method: "POST", body: JSON.stringify(input) }),

  getBoxScore: (submissionId: string) =>
    recFetch<any>("/v1/box-score/get", { method: "POST", body: JSON.stringify({ submissionId }) }),

  listPendingBoxScores: (guildId: string) =>
    recFetch<{ submissions: any[] }>("/v1/box-score/pending", { method: "POST", body: JSON.stringify({ guildId }) }),

  listBoxScoreGames: (input: { guildId: string; weekNumber: number; seasonNumber?: number | null }) =>
    recFetch<any>("/v1/box-score/games", { method: "POST", body: JSON.stringify(input) }),

  listCommissionerNotifications: (input: { guildId: string; sinceIso?: string | null }) =>
    recFetch<{ notifications: Array<{ id: string; type: string; title: string; subtitle: string; amount: number | null; submittedBy: string | null; submittedAt: string }> }>(
      "/v1/notifications/list",
      { method: "POST", body: JSON.stringify(input) },
    ),
  listUnattendedCommissionerNotifications: (guildId: string) =>
    recFetch<{ notifications: Array<{ id: string; header: string; summary: string | null }> }>("/v1/notifications/dm-pending", { method: "POST", body: JSON.stringify({ guildId }) }),
  markCommissionerNotificationDms: (guildId: string, ids: string[]) =>
    recFetch<{ updated: number }>("/v1/notifications/dm-mark", { method: "POST", body: JSON.stringify({ guildId, ids }) }),

  getBoxScoreUploadEligibility: (input: { guildId: string; discordId: string }) =>
    recFetch<any>("/v1/box-score/upload-eligibility", { method: "POST", body: JSON.stringify(input) }),

  appendBoxScoreImage: (input: { guildId: string; discordId: string; imageUrl: string }) =>
    recFetch<{ submissionId: string; imageStorageUrl: string | null; imageCount: number }>("/v1/box-score/append-image", { method: "POST", body: JSON.stringify(input) }),
  submitPlayerStatLine: (input: { guildId: string; discordId: string; playerName: string; category: string; statLines: Array<{ statKey: string; label: string; value: number }> }) => recFetch<any>("/v1/watched-players/submit-stat-line", { method: "POST", body: JSON.stringify(input) }),
  listMyWatchedPlayers: (input: { guildId: string; discordId: string }) => recFetch<{ players: Array<{ id: string; playerName: string; position: string }> }>("/v1/watched-players/my-list", { method: "POST", body: JSON.stringify(input) }),
  removeMyPlayerStatLine:(input:{guildId:string;discordId:string;playerName:string;category:string})=>recFetch<any>("/v1/watched-players/remove-stat-line",{method:"POST",body:JSON.stringify(input)}),
  getGuideMessageState: (guildId: string) => recFetch<{ messages: Array<{ section_index: number; discord_channel_id: string; discord_message_id: string }> }>("/v1/submission-state/guide/get", { method: "POST", body: JSON.stringify({ guildId }) }),
  saveGuideMessageState: (input: { guildId: string; channelId: string; messageIds: string[] }) => recFetch<any>("/v1/submission-state/guide/save", { method: "POST", body: JSON.stringify(input) }),
  saveWeeklyPanelState: (input: { guildId: string; seasonNumber: number; seasonStage: string; weekNumber: number | null; channelId: string; messageId: string }) => recFetch<any>("/v1/submission-state/panel/save", { method: "POST", body: JSON.stringify(input) }),
  submitRecruitCommit: (input: { guildId: string; discordId: string; playerName: string; position: string; starRating: number; homeCity: string; homeState: string }) => recFetch<any>("/v1/recruiting/submit-commit", { method: "POST", body: JSON.stringify(input) }),

  updateBoxScoreLedgerMessage: (input: { submissionId: string; ledgerDiscordMessageId: string }) =>
    recFetch<any>("/v1/box-score/ledger-message", { method: "POST", body: JSON.stringify(input) }),

  listBoxScoresPendingDiscordCleanup: (guildId: string) =>
    recFetch<{ submissions: Array<{ submissionId: string; discordChannelId: string; discordMessageId: string; extraDiscordMessageIds: string[]; ledgerDiscordMessageId: string | null }> }>(
      "/v1/box-score/pending-cleanup",
      { method: "POST", body: JSON.stringify({ guildId }) },
    ),
  markBoxScoreDiscordCleanupDone: (submissionId: string) =>
    recFetch<any>("/v1/box-score/mark-cleanup-done", { method: "POST", body: JSON.stringify({ submissionId }) }),

  listScheduleTeams: (guildId: string) =>
    recFetch<any>("/v1/schedule/teams", { method: "POST", body: JSON.stringify({ guildId }) }),

  listScheduleWeek: (input: { guildId: string; weekNumber: number; seasonNumber?: number | null }) =>
    recFetch<any>("/v1/schedule/week", { method: "POST", body: JSON.stringify(input) }),

  listScheduleSeason: (input: { guildId: string; seasonNumber?: number | null }) =>
    recFetch<any>("/v1/schedule/season", { method: "POST", body: JSON.stringify(input) }),

  previewCfbTeamScheduleImport: (input: { guildId: string; teamId: string; imageUrls: string[]; seasonNumber?: number | null }) =>
    recFetch<any>("/v1/schedule/cfb-team-import-preview", { method: "POST", body: JSON.stringify(input) }),

  commitCfbTeamScheduleImport: (input: {
    guildId: string;
    teamId: string;
    seasonNumber?: number | null;
    decisions: Array<{ weekNumber: number; opponentTeamId: string; homeAway: "home" | "away" }>;
    requestedByDiscordId?: string | null;
  }) =>
    recFetch<any>("/v1/schedule/team-schedule-commit", { method: "POST", body: JSON.stringify(input) }),

  getLeagueSos: (guildId: string, discordId: string) =>
    recFetch<any>("/v1/schedule/sos", { method: "POST", body: JSON.stringify({ guildId, discordId }) }),

  getPowerRankings: (guildId: string, discordId?: string | null, completedWeekNumber?: number | null) =>
    recFetch<any>("/v1/schedule/power-rankings", { method: "POST", body: JSON.stringify({ guildId, discordId, completedWeekNumber }) }),

  // ─── Wagers ───
  listWagerGames: (guildId: string, discordId: string) =>
    recFetch<any>("/v1/wagers/games", { method: "POST", body: JSON.stringify({ guildId, discordId }) }),
  getWagerOptions: (guildId: string, gameId: string) =>
    recFetch<any>("/v1/wagers/options", { method: "POST", body: JSON.stringify({ guildId, gameId }) }),
  placeHouseWager: (input: { guildId: string; discordId: string; gameId: string; market: string; pick: string; stake: number; customLine?: number | null }) =>
    recFetch<any>("/v1/wagers/place-house", { method: "POST", body: JSON.stringify(input) }),
  attachWagerPendingMessage: (input: { wagerId: string; channelId: string; messageId: string }) =>
    recFetch<any>("/v1/wagers/attach-message", { method: "POST", body: JSON.stringify(input) }),
  settleWager: (wagerId: string, reviewedByDiscordId: string) =>
    recFetch<any>("/v1/wagers/settle", { method: "POST", body: JSON.stringify({ wagerId, reviewedByDiscordId }) }),
  cancelWager: (wagerId: string) =>
    recFetch<any>("/v1/wagers/cancel", { method: "POST", body: JSON.stringify({ wagerId }) }),
  getWagerResolvability: (guildId: string, wagerId: string) =>
    recFetch<any>("/v1/wagers/resolvability", { method: "POST", body: JSON.stringify({ guildId, wagerId }) }),
  listConfirmableWagers: (guildId: string) =>
    recFetch<any>("/v1/wagers/confirmable", { method: "POST", body: JSON.stringify({ guildId }) }),
  placePeerWager: (input: { guildId: string; discordId: string; gameId: string; market: string; pick: string; stake: number; challengeType: "open" | "direct"; targetUserId?: string | null; customLine?: number | null }) =>
    recFetch<any>("/v1/wagers/place-peer", { method: "POST", body: JSON.stringify(input) }),
  placeParlay: (input: { guildId: string; discordId: string; stake: number; legs: Array<{ gameId: string; market: string; pick: string; customLine?: number | null }> }) =>
    recFetch<any>("/v1/wagers/place-parlay", { method: "POST", body: JSON.stringify(input) }),
  acceptPeerWager: (guildId: string, discordId: string, wagerId: string) =>
    recFetch<any>("/v1/wagers/accept-peer", { method: "POST", body: JSON.stringify({ guildId, discordId, wagerId }) }),
  declinePeerWager: (wagerId: string) =>
    recFetch<any>("/v1/wagers/decline-peer", { method: "POST", body: JSON.stringify({ wagerId }) }),
  getPeerWagerForCounter: (guildId: string, wagerId: string) =>
    recFetch<any>("/v1/wagers/counter/options", { method: "POST", body: JSON.stringify({ guildId, wagerId }) }),
  placeCounterWager: (input: { guildId: string; discordId: string; originalWagerId: string; market: string; pick: string; stake: number; customLine?: number | null }) =>
    recFetch<any>("/v1/wagers/counter/place", { method: "POST", body: JSON.stringify(input) }),
  acceptCounter: (guildId: string, discordId: string, counterWagerId: string) =>
    recFetch<any>("/v1/wagers/counter/accept", { method: "POST", body: JSON.stringify({ guildId, discordId, counterWagerId }) }),
  declineCounter: (discordId: string, counterWagerId: string) =>
    recFetch<any>("/v1/wagers/counter/decline", { method: "POST", body: JSON.stringify({ discordId, counterWagerId }) }),
  listChallengeableCoaches: (guildId: string, discordId: string) =>
    recFetch<any>("/v1/wagers/challengeable-coaches", { method: "POST", body: JSON.stringify({ guildId, discordId }) }),
  attachWagerAnnouncementMessage: (input: { wagerId: string; channelId: string; messageId: string }) =>
    recFetch<any>("/v1/wagers/attach-announcement", { method: "POST", body: JSON.stringify(input) }),

  // ─── Legends ───
  listLegendCatalog: (guildId: string) =>
    recFetch<any>("/v1/legends/catalog", { method: "POST", body: JSON.stringify({ guildId }) }),
  listLegendAvailability: (guildId: string) =>
    recFetch<any>("/v1/legends/availability", { method: "POST", body: JSON.stringify({ guildId }) }),
  purchaseLegend: (input: { guildId: string; discordId: string; legendId: string; replacePlayerRequest?: string | null }) =>
    recFetch<any>("/v1/legends/purchase", { method: "POST", body: JSON.stringify(input) }),

  saveManualScheduleGame: (input: {
    guildId: string;
    seasonNumber?: number | null;
    weekNumber: number;
    slotNumber: number;
    awayTeamId: string;
    homeTeamId: string;
    requestedByDiscordId?: string | null;
  }) =>
    recFetch<any>("/v1/schedule/manual-game", { method: "POST", body: JSON.stringify(input) }),

  seedDefaultSchedule: (input: { guildId: string; requestedByDiscordId?: string | null; force?: boolean }) =>
    recFetch<any>(REC_API_ROUTES.scheduleSeedDefault, { method: "POST", body: JSON.stringify(input) }),

  replaceScheduleWeek: (input: {
    guildId: string;
    seasonNumber?: number | null;
    weekNumber: number;
    games: Array<{ awayTeamId: string; homeTeamId: string }>;
    requestedByDiscordId?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.scheduleReplaceWeek, { method: "POST", body: JSON.stringify(input) }),

  previewScheduleImport: (input: { guildId: string; weekNumber: number; imageUrls: string[] }) =>
    recFetch<any>("/v1/schedule/import-preview", { method: "POST", body: JSON.stringify(input) }),

  listTrackedGameChannels: (guildId: string) =>
    recFetch<{ discordChannelIds: string[] }>(REC_API_ROUTES.gameChannelsTracked, {
      method: "POST",
      body: JSON.stringify({ guildId }),
    }),

  registerGameChannel: (input: {
    guildId: string;
    gameId?: string | null;
    discordChannelId: string;
    seasonNumber: number;
    weekNumber: number;
    awayTeamId?: string | null;
    homeTeamId?: string | null;
    awayUserId?: string | null;
    homeUserId?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.gameChannelsRegister, { method: "POST", body: JSON.stringify(input) }),

  markGameChannelsDeleted: (discordChannelIds: string[]) =>
    recFetch<{ updated: number }>(REC_API_ROUTES.gameChannelsMarkDeleted, {
      method: "POST",
      body: JSON.stringify({ discordChannelIds }),
    }),

  getGameChannelMatchup: (input: { guildId: string; discordChannelId: string }) =>
    recFetch<any>("/v1/game-channels/matchup", { method: "POST", body: JSON.stringify(input) }),

  getGameChannelMatchups: (input: { guildId: string }) =>
    recFetch<{ matchups: Record<string, any> }>("/v1/game-channels/matchups", { method: "POST", body: JSON.stringify(input) }),

  createPurchaseRequest: (input: { guildId: string; discordId: string; purchaseType: string; details: Record<string, unknown> }) =>
    recFetch<any>("/v1/purchases/create", { method: "POST", body: JSON.stringify(input) }),
  reviewPurchase: (input: { purchaseId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) =>
    recFetch<any>("/v1/purchases/review", { method: "POST", body: JSON.stringify(input) }),
  listPendingPurchases: (guildId: string) =>
    recFetch<any>("/v1/purchases/pending", { method: "POST", body: JSON.stringify({ guildId }) }),
  getPurchaseCounts: (discordId: string, guildId: string) =>
    recFetch<any>("/v1/purchases/counts", { method: "POST", body: JSON.stringify({ discordId, guildId }) }),
};
