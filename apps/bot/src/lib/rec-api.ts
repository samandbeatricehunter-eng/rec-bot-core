import { REC_API_ROUTES, type RecImportMode, type RecTeamAuthority } from "@rec/shared";
import { env } from "../config/env.js";
import type { LeagueSetupDraft } from "../ui/league-setup.js";

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

  discoverEaFranchises: (input: {
    discordId: string;
    console?: "xone" | "ps4" | "pc" | "ps5" | "xbsx" | "stadia";
  }) =>
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
    importScope?: "single_week" | "selected_weeks" | "full_available" | "full_regular_season_schedule";
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
  getImportMissingResults: (jobId: string) => recFetch<any>(REC_API_ROUTES.importMissingResults(jobId)),

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
      body: JSON.stringify({ requestedByDiscordId: input.requestedByDiscordId, notes: input.notes ?? null })
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
      body: JSON.stringify({ requestedByDiscordId: input.requestedByDiscordId, notes: input.notes ?? null })
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
    })
};
