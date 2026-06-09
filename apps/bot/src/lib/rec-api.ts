import { REC_API_ROUTES, type RecImportMode, type RecTeamAuthority } from "@rec/shared";
import { env } from "../config/env.js";
import type { LeagueSetupDraft } from "../ui/league-setup.js";

type RecEaConsole = "xone" | "ps4" | "pc" | "ps5" | "xbsx" | "stadia";
type RecImportScope = "current_week" | "single_week" | "full_regular_season_schedule";

async function recFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.REC_CORE_API_URL}${path}`, {
    ...init,
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
  getBaseline: (discordId: string) => recFetch<any>(REC_API_ROUTES.userBaseline(discordId)),
  getWallet: (discordId: string) => recFetch<any>(REC_API_ROUTES.userWallet(discordId)),

  // Direct path used here because this route is newer than the shared REC_API_ROUTES object
  // in some local builds.
  getMenuProfile: (discordId: string, guildId: string) =>
    recFetch<any>(`/v1/users/${discordId}/menu-profile?guildId=${guildId}`),

  registerServer: (input: {
    guildId: string;
    name: string;
    setupMode?: string;
    requestedByDiscordId?: string;
  }) =>
    recFetch<any>(REC_API_ROUTES.registerServer, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  createLeague: (input: LeagueSetupDraft & {
    guildId: string;
    requestedByDiscordId?: string;
  }) =>
    recFetch<any>(REC_API_ROUTES.createLeague, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  createDefaultTeams: (guildId: string) =>
    recFetch<any>(REC_API_ROUTES.createDefaultTeams, {
      method: "POST",
      body: JSON.stringify({ guildId })
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
    requestedByDiscordId?: string;
  }) =>
    recFetch<any>(REC_API_ROUTES.createCustomTeamReplacement, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getEaAccountStatus: (input: { discordId: string; console?: RecEaConsole }) =>
    recFetch<any>(REC_API_ROUTES.eaAccountStatus, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  connectEaAccount: (input: { discordId: string; code: string; console?: RecEaConsole }) =>
    recFetch<any>(REC_API_ROUTES.eaAccountConnect, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  discoverEaFranchises: (input: { discordId: string; console?: RecEaConsole }) =>
    recFetch<any>(REC_API_ROUTES.discoverEaFranchises, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getEaFranchises: (guildId: string) => recFetch<any>(REC_API_ROUTES.eaFranchises(guildId)),

  selectEaFranchise: (input: {
    guildId: string;
    eaFranchiseId: string;
    selectedByDiscordId: string;
    replacementReason?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.selectEaFranchise, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  createImportJob: (input: {
    guildId: string;
    importMode: RecImportMode;
    importLabel?: string;
    requestedByDiscordId?: string;
    eaExternalLeagueId?: string;
    eaExternalLeagueName?: string;
    importScope?: RecImportScope;
    weekFrom?: number;
    weekTo?: number;
    selectedEndpointKeys?: string[];
  }) =>
    recFetch<any>(REC_API_ROUTES.createImportJob, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getImportJob: (jobId: string) => recFetch<any>(REC_API_ROUTES.importJob(jobId)),
  getImportStatus: (guildId: string) => recFetch<any>(REC_API_ROUTES.importStatus(guildId)),
  getImportHistory: (guildId: string) => recFetch<any>(REC_API_ROUTES.importHistory(guildId)),
  getActiveImport: (guildId: string) => recFetch<any>(REC_API_ROUTES.activeImport(guildId)),

  cancelActiveImport: (input: { guildId: string; reason?: string | null }) =>
    recFetch<any>(REC_API_ROUTES.cancelActiveImport, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getImportMissingResults: (jobId: string) => recFetch<any>(REC_API_ROUTES.importMissingResults(jobId)),

  stageImportEndpoint: (input: { importJobId: string; endpointKey: string }) =>
    recFetch<any>("/v1/imports/job/stage-endpoint", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  executeImportJob: (importJobId: string) =>
    recFetch<any>(REC_API_ROUTES.executeImportJob, {
      method: "POST",
      body: JSON.stringify({ importJobId })
    }),

  previewImportJob: (importJobId: string) =>
    recFetch<any>(REC_API_ROUTES.previewImportJob, {
      method: "POST",
      body: JSON.stringify({ importJobId })
    }),

  approveImportJob: (importJobId: string) =>
    recFetch<any>(REC_API_ROUTES.approveImportJob, {
      method: "POST",
      body: JSON.stringify({ importJobId })
    }),

  cancelImportJob: (input: { importJobId: string; reason?: string | null }) =>
    recFetch<any>(REC_API_ROUTES.cancelImportJob, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  requestMissingResultReimport: (input: {
    gameId: string;
    requestedByDiscordId: string;
    notes?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.requestMissingResultReimport(input.gameId), {
      method: "POST",
      body: JSON.stringify({
        requestedByDiscordId: input.requestedByDiscordId,
        notes: input.notes ?? null
      })
    }),

  manuallyResolveMissingResult: (input: {
    gameId: string;
    homeScore: number;
    awayScore: number;
    resolvedByDiscordId: string;
    notes?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.manualMissingResultScore(input.gameId), {
      method: "POST",
      body: JSON.stringify({
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        resolvedByDiscordId: input.resolvedByDiscordId,
        notes: input.notes ?? null
      })
    }),

  ignoreMissingResult: (input: {
    gameId: string;
    requestedByDiscordId: string;
    notes?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.ignoreMissingResult(input.gameId), {
      method: "POST",
      body: JSON.stringify({
        requestedByDiscordId: input.requestedByDiscordId,
        notes: input.notes ?? null
      })
    }),

  updateImportJobStatus: (input: {
    importJobId: string;
    status: string;
    previewSummary?: Record<string, unknown>;
    validationErrors?: unknown[];
    validationWarnings?: unknown[];
    failureReason?: string | null;
  }) =>
    recFetch<any>(REC_API_ROUTES.updateImportJobStatus, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  updateImportEndpointAttempt: (input: {
    importJobId: string;
    endpointKey: string;
    endpointLabel: string;
    status: "pending" | "running" | "success" | "failed" | "skipped";
    httpStatus?: number | null;
    attemptNumber?: number;
    durationMs?: number | null;
    recordsFound?: number | null;
    errorMessage?: string | null;
    responseSummary?: Record<string, unknown>;
  }) =>
    recFetch<any>(REC_API_ROUTES.updateImportEndpointAttempt, {
      method: "POST",
      body: JSON.stringify(input)
    }),

  setEconomyConfig: (input: {
    guildId: string;
    pendingEconomyChannelId?: string;
    pendingPayoutsChannelId?: string;
    gameChannelsCategoryId?: string;
    commissionerOfficeChannelId?: string;
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

  clearPendingEosBatch: (input: { guildId: string; clearReason: string }) =>
    recFetch<any>("/v1/eos/clear-pending", {
      method: "POST",
      body: JSON.stringify(input)
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

  regenerateWeeklyChallenges: (guildId: string) =>
    recFetch<any>("/v1/challenges/regenerate", {
      method: "POST",
      body: JSON.stringify({ guildId, regenerate: true })
    }),

  getChallengeAudit: (guildId: string) =>
    recFetch<any>("/v1/challenges/audit", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  postAdvanceAutomation: (guildId: string, mode: "normal" | "catch_up" = "normal") =>
    recFetch<any>("/v1/advance/post-advance", {
      method: "POST",
      body: JSON.stringify({ guildId, mode })
    }),

  getGameChannelPlans: (guildId: string) =>
    recFetch<any>("/v1/game-channels/plans", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  getActiveGameChannels: (guildId: string) =>
    recFetch<any>("/v1/game-channels/active", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  recordGameChannel: (input: any) =>
    recFetch<any>("/v1/game-channels/record", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  markGameChannelDeleted: (discordChannelId: string) =>
    recFetch<any>("/v1/game-channels/deleted", {
      method: "POST",
      body: JSON.stringify({ discordChannelId })
    }),

  recordGameChannelCheckin: (input: { discordChannelId: string; discordUserId: string }) =>
    recFetch<any>("/v1/game-channels/checkin", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getReminderState: (guildId: string) =>
    recFetch<any>("/v1/game-channels/reminder-state", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  recordGameChannelReminder: (input: any) =>
    recFetch<any>("/v1/game-channels/reminder", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getGotwCandidates: (guildId: string) =>
    recFetch<any>("/v1/gotw/candidates", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  selectGotwCandidate: (input: {
    guildId: string;
    candidateId: string;
    selectedByDiscordId: string;
  }) =>
    recFetch<any>("/v1/gotw/select", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  recordGotwPollMessage: (input: {
    pollId: string;
    discordChannelId: string;
    discordMessageId?: string | null;
    discordThreadId?: string | null;
  }) =>
    recFetch<any>("/v1/gotw/poll-message", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  recordGotwVote: (input: {
    pollId: string;
    discordId: string;
    selectedTeamId: string;
  }) =>
    recFetch<any>("/v1/gotw/vote", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  getGotwVotes: (pollId: string) =>
    recFetch<any>("/v1/gotw/votes", {
      method: "POST",
      body: JSON.stringify({ pollId })
    }),

  settleGotwVotes: (guildId: string) =>
    recFetch<any>("/v1/gotw/settle", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  createActiveCheck: (input: { guildId: string; createdByDiscordId: string }) =>
    recFetch<any>("/v1/active-check/create", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  recordActiveCheckMessage: (input: {
    eventId: string;
    discordChannelId: string;
    discordMessageId: string;
  }) =>
    recFetch<any>("/v1/active-check/message", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  recordActiveCheckResponse: (input: { eventId: string; discordId: string }) =>
    recFetch<any>("/v1/active-check/respond", {
      method: "POST",
      body: JSON.stringify(input)
    }),

  closeActiveCheck: (eventId: string) =>
    recFetch<any>("/v1/active-check/close", {
      method: "POST",
      body: JSON.stringify({ eventId })
    }),

  getOpenActiveChecks: (guildId: string) =>
    recFetch<any>("/v1/active-check/open", {
      method: "POST",
      body: JSON.stringify({ guildId })
    }),

  recordStreamPost: (input: {
    guildId: string;
    discordId: string;
    discordChannelId: string;
    discordMessageId: string;
    messageUrl?: string | null;
    content?: string | null;
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
    })
};