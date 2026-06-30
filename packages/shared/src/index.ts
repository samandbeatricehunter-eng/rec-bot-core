export * from "./nfl-teams.js";
export * from "./cfb-teams.js";
export * from "./nfl-schedules.js";
export * from "./route-channels.js";
export * from "./stats/index.js";
export * from "./madden/index.js";

export const REC_API_ROUTES = {
  health: "/health",
  userBaseline: (discordId: string) => `/v1/users/${discordId}/baseline`,
  userWallet: (discordId: string) => `/v1/users/${discordId}/wallet`,
  menuProfile: (discordId: string, guildId: string) => `/v1/users/${discordId}/menu-profile?guildId=${encodeURIComponent(guildId)}`,
  userSchedule: (discordId: string, guildId: string) => `/v1/users/${discordId}/schedule?guildId=${encodeURIComponent(guildId)}`,
  userSnapshot: (discordId: string, guildId: string) => `/v1/users/${discordId}/snapshot?guildId=${encodeURIComponent(guildId)}`,
  transferWallet: (discordId: string) => `/v1/users/${discordId}/wallet/transfer`,

  registerServer: "/v1/setup/server/register",
  createLeague: "/v1/setup/league/create",
  getLeagueConfig: "/v1/setup/league/config",
  updateLeagueConfig: "/v1/setup/league/config/update",
  deleteLeague: "/v1/setup/league/delete",
  updateServerRoutes: "/v1/setup/server/routes",

  createDefaultTeams: "/v1/team-ownership/default-teams",
  resetDefaultTeams: "/v1/team-ownership/reset-default-teams",
  linkedUsersTeams: (guildId: string) => `/v1/team-ownership/${guildId}/linked`,
  openTeams: (guildId: string) => `/v1/team-ownership/${guildId}/open-teams`,
  linkUserToTeam: "/v1/team-ownership/link-user-team",
  createCustomTeamReplacement: "/v1/team-ownership/custom-team-replacement",
  unlinkAllTeams: "/v1/team-ownership/unlink-all",
  unlinkTeam: "/v1/team-ownership/unlink-team",

  serverConfigView: "/v1/economy/config/view",
  serverConfigSet: "/v1/economy/config/set",
  viewLeagueWeek: "/v1/league-week/view",
  setLeagueWeek: "/v1/league-week/set",
  recordStreamPost: "/v1/streams/post",
  reviewStreamPayout: "/v1/streams/review",
  leagueConferences: "/v1/rosters/conferences",

  scheduleSeedDefault: "/v1/schedule/seed-default",
  scheduleReplaceWeek: "/v1/schedule/replace-week",
  gameChannelsTracked: "/v1/game-channels/tracked",
  gameChannelsRegister: "/v1/game-channels/register",
  gameChannelsMarkDeleted: "/v1/game-channels/mark-deleted",
} as const;

export type RecTeamAuthority = "member" | "commissioner" | "co_commissioner";

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
export * from "./economy.js";
export * from "./purchases.js";
export * from "./wagers.js";
