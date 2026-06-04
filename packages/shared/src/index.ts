export * from "./nfl-teams.js";

export const REC_API_ROUTES = {
  health: "/health",
  userBaseline: (discordId: string) => `/v1/users/${discordId}/baseline`,
  userWallet: (discordId: string) => `/v1/users/${discordId}/wallet`,


  
  registerServer: "/v1/setup/server/register",
  createLeague: "/v1/setup/league/create",
  updateServerRoutes: "/v1/setup/server/routes",

  createDefaultTeams: "/v1/team-ownership/default-teams",
  linkedUsersTeams: (guildId: string) => `/v1/team-ownership/${guildId}/linked`,
  openTeams: (guildId: string) => `/v1/team-ownership/${guildId}/open-teams`,
  linkUserToTeam: "/v1/team-ownership/link-user-team",
  createCustomTeamReplacement: "/v1/team-ownership/custom-team-replacement",

  createImportJob: "/v1/imports/create",
  importJob: (jobId: string) => `/v1/imports/${jobId}`,
  importMissingResults: (jobId: string) => `/v1/imports/${jobId}/missing-results`,
  importStatus: (guildId: string) => `/v1/imports/guild/${guildId}/status`,
  importHistory: (guildId: string) => `/v1/imports/guild/${guildId}/history`,
  eaAccountStatus: "/v1/imports/ea-account/status",
eaAccountConnect: "/v1/imports/ea-account/connect",
discoverEaFranchises: "/v1/imports/ea-franchise/discover",
eaFranchises: (guildId: string) => `/v1/imports/ea-franchise/${guildId}`,
selectEaFranchise: "/v1/imports/ea-franchise/select",
  updateImportJobStatus: "/v1/imports/job/status",
  updateImportEndpointAttempt: "/v1/imports/job/endpoint",
  executeImportJob: "/v1/imports/job/execute",
  previewImportJob: "/v1/imports/job/preview",
  approveImportJob: "/v1/imports/job/approve",
  cancelImportJob: "/v1/imports/job/cancel",
  requestMissingResultReimport: (gameId: string) => `/v1/imports/missing-results/${gameId}/reimport`,
  manualMissingResultScore: (gameId: string) => `/v1/imports/missing-results/${gameId}/manual-score`,
  ignoreMissingResult: (gameId: string) => `/v1/imports/missing-results/${gameId}/ignore`
} as const;

export type RecTeamAuthority = "member" | "commissioner" | "co_commissioner";
export type RecImportMode = "manual" | "ea_import" | "companion_app_export";
export type RecImportStatus =
  | "created"
  | "queued"
  | "running"
  | "validating"
  | "reconciling"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled";

export type RecWallet = { user_id: string; wallet_balance: number; savings_balance: number };
export type RecGlobalRecord = {
  wins: number;
  losses: number;
  ties: number;
  playoff_wins: number;
  playoff_losses: number;
  superbowl_wins: number;
  superbowl_losses: number;
  point_differential: number;
};
