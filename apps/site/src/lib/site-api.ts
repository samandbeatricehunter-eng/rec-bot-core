import type { RecGlobalEconomyConfig, TournamentRules } from "@rec/shared";
import { createReadCache } from "./read-cache.js";
import { siteApiBaseUrl, supabase } from "./supabase-client.js";

const apiBaseUrl = () => siteApiBaseUrl() || (import.meta.env.VITE_REC_CORE_API_URL as string | undefined);

export type SubscriptionTier = "none" | "gold" | "platinum";
export type BillingStatus =
  | "none"
  | "active"
  | "lifetime_comp"
  | "past_due"
  | "canceled"
  | "grace"
  | "promo_trial";

export type EntitlementSummary = {
  tier: SubscriptionTier;
  billingStatus: BillingStatus;
  graceUntil: string | null;
  currentPeriodEnd: string | null;
  promoTrialEndsAt: string | null;
  siteAccess: boolean;
  canCreateLeague: boolean;
  canEnableDiscordBot: boolean;
  joinLimit: number;
  ownLimit: number;
  ownedCounts: Record<string, number>;
  joinCounts: Record<string, number>;
  claimDropdownOpen: boolean;
};

export type LinkProfileResponse = {
  linked: boolean;
  recUserId: string | null;
  displayName: string | null;
  username: string | null;
  discordUsername?: string | null;
  avatarUrl?: string | null;
  entitlements?: EntitlementSummary | null;
  claimDropdownOpen?: boolean;
  /** Hub identity: real Discord snowflake, or a site-only synthetic id. */
  discordId?: string | null;
};

export type StreamPlatform = "twitch" | "youtube" | "tiktok";

export type StreamingAccount = {
  platform: StreamPlatform;
  login: string;
  displayName: string | null;
  profileUrl: string | null;
  status: string;
  streamUrl: string;
};

export type StreamingAccountsResponse = {
  accounts: StreamingAccount[];
  configured: {
    twitch: boolean;
    youtube: boolean;
    tiktokOAuth: boolean;
    twitchUsername?: boolean;
    youtubeUsername?: boolean;
    tiktokUsername: boolean;
    publicApi: boolean;
  };
};

export type StreamingMatchupOption = {
  gameId: string;
  leagueId: string;
  weekNumber: number | null;
  awayTeamName: string;
  homeTeamName: string;
  serverName: string;
  label: string;
  scheduledFor: string | null;
};

export type LinkCandidate = {
  recUserId: string;
  discordAccountId: string;
  discordUsername: string;
  teamLabel: string;
};

type LinkCandidatesResponse = {
  total: number;
  candidates: LinkCandidate[];
};

export type RegistrationGate = {
  claimDropdownOpen: boolean;
  requiresPaidSubscriptionToRegister: boolean;
};

function requireApiBaseUrl(): string {
  const base = apiBaseUrl();
  if (!base) {
    throw new Error("Missing VITE_REC_CORE_API_URL in apps/site/.env.");
  }
  return base;
}

const siteReadCache = createReadCache();
const READ_TTL_MS: Record<string, number> = {
  "/v1/site-auth/me": 15_000,
  "/v1/site-leagues/mine": 15_000,
  "/v1/site-leagues/open-hub": 30_000,
  "/v1/site-leagues/ticker": 10_000,
  "/v1/site-home/card": 15_000,
  "/v1/site-home/announcements": 30_000,
  "/v1/site-home/spotlight": 20_000,
  "/v1/site-notifications/counts": 10_000,
  "/v1/subscriptions/me": 15_000,
};

let sessionCache: { token: string; expiresAt: number } | null = null;
let sessionInflight: Promise<string> | null = null;

async function requireAccessToken(): Promise<string> {
  if (sessionCache && sessionCache.expiresAt > Date.now() + 10_000) return sessionCache.token;
  if (sessionInflight) return sessionInflight;
  sessionInflight = (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("You are not signed in.");
    const expiresAt = session.expires_at ? session.expires_at * 1000 : Date.now() + 50_000;
    sessionCache = { token, expiresAt };
    return token;
  })().finally(() => {
    sessionInflight = null;
  });
  return sessionInflight;
}

function invalidateRelatedCaches(path: string) {
  if (path === "/v1/site-auth/me" || path === "/v1/site-leagues/mine") return;
  if (path.startsWith("/v1/site-auth/") || path.startsWith("/v1/subscriptions/")) {
    siteReadCache.invalidate("/v1/site-auth/me");
    siteReadCache.invalidate("/v1/subscriptions/me");
  }
  if (path.startsWith("/v1/site-leagues/") && path !== "/v1/site-leagues/open-hub" && path !== "/v1/site-leagues/ticker") {
    siteReadCache.invalidate("/v1/site-leagues/mine");
    siteReadCache.invalidate("/v1/site-leagues/open-hub");
    siteReadCache.invalidate("/v1/site-leagues/ticker");
  }
  if (path.startsWith("/v1/site-home/spotlight/react")) {
    siteReadCache.invalidate("/v1/site-home/spotlight");
  }
  if (path.startsWith("/v1/site-notifications/") && path !== "/v1/site-notifications/counts") {
    siteReadCache.invalidate("/v1/site-notifications/counts");
  }
}

async function requestUncached<T>(path: string, body: unknown = {}): Promise<T> {
  const base = requireApiBaseUrl();
  const token = await requireAccessToken();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;
  if (response.status === 401) {
    sessionCache = null;
    siteReadCache.invalidate();
  }
  if (!response.ok) {
    // The API's sendError returns {error: "..."} with a plain-language message for 5xx,
    // or {error, details} for 4xx. Prefer .error (always user-friendly), then .message.
    // For 5xx with no parseable body, use a generic fallback instead of "Request failed."
    if (response.status >= 500) {
      throw new Error(payload?.error ?? "Something went wrong on our end. Please try again.");
    }
    throw new Error(payload?.error ?? payload?.message ?? "That request couldn't be completed.");
  }
  return payload as T;
}

async function request<T>(path: string, body: unknown = {}): Promise<T> {
  const ttl = READ_TTL_MS[path];
  if (ttl) {
    return siteReadCache.get(`${path}:${JSON.stringify(body)}`, ttl, () => requestUncached<T>(path, body));
  }
  const result = await requestUncached<T>(path, body);
  invalidateRelatedCaches(path);
  return result;
}

const HUB_OPEN_CACHE_PREFIX = "rec-hub-open:";

export function readCachedHubOpen(leagueId: string): { guildId: string; discordId: string } | null {
  try {
    const raw = sessionStorage.getItem(`${HUB_OPEN_CACHE_PREFIX}${leagueId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { guildId?: unknown; discordId?: unknown };
    const guildId = String(parsed.guildId ?? "").trim();
    const discordId = String(parsed.discordId ?? "").trim();
    if (!guildId || !discordId) return null;
    return { guildId, discordId };
  } catch {
    return null;
  }
}

export function persistCachedHubOpen(leagueId: string, context: { guildId: string; discordId: string }) {
  try {
    sessionStorage.setItem(`${HUB_OPEN_CACHE_PREFIX}${leagueId}`, JSON.stringify(context));
  } catch {
    /* ignore quota / private mode */
  }
}

function clearCachedHubOpens() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(HUB_OPEN_CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearSiteApiCaches() {
  sessionCache = null;
  sessionInflight = null;
  siteReadCache.invalidate();
  clearCachedHubOpens();
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const base = requireApiBaseUrl();
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;
  if (!response.ok) {
    // The API's sendError returns {error: "..."} with a plain-language message for 5xx,
    // or {error, details} for 4xx. Prefer .error (always user-friendly), then .message.
    // For 5xx with no parseable body, use a generic fallback instead of "Request failed."
    if (response.status >= 500) {
      throw new Error(payload?.error ?? "Something went wrong on our end. Please try again.");
    }
    throw new Error(payload?.error ?? payload?.message ?? "That request couldn't be completed.");
  }
  return payload as T;
}

export type SiteFriendship = {
  friendshipId: string;
  status: string;
  createdAt: string;
  respondedAt: string | null;
  direction: "incoming" | "outgoing";
  peer: {
    userId: string;
    username: string;
    displayName: string;
  };
};

export type SiteConversation = {
  id: string;
  kind: string;
  leagueId: string | null;
  label: string;
  peerUserId: string | null;
  peerUsername: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: boolean;
};

export type SiteMessage = {
  id: string;
  conversationId: string;
  authorUserId: string;
  authorUsername?: string | null;
  authorDisplayName?: string | null;
  body: string;
  createdAt: string;
  reportedAt: string | null;
};

export type SiteLeagueInvite = {
  inviteId: string;
  status: string;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  invitee: {
    userId: string;
    username: string;
    displayName: string;
  };
};

export type SiteLeagueInvitePending = {
  inviteId: string;
  leagueId: string;
  leagueName: string;
  message: string | null;
  createdAt: string;
  inviter: {
    userId: string;
    username: string;
    displayName: string;
  };
};

export type DmTarget = {
  userId: string;
  username: string;
  displayName: string;
};

export type SiteLeagueSummary = {
  id: string;
  name: string;
  logoUrl: string | null;
  game: string;
  gameLabel: string;
  teamName: string | null;
  isCommissioner: boolean;
  commissionerRole?: "head" | "co" | "member";
  discordBotEnabled: boolean;
  /** Discord guild id, or a site-only synthetic id when the league has no Discord server. */
  guildId?: string | null;
  maxMembers?: number;
  memberCount?: number;
  seasonStage?: string;
  seasonStageLabel?: string;
  currentWeek?: number | null;
  matchupKind?: "h2h" | "cpu" | "bye" | "offseason" | "none";
  matchupLabel?: string;
};

export type SiteLeagueTickerItem = {
  gameId: string;
  awayTeamName: string;
  homeTeamName: string;
  awayTeamAbbr: string | null;
  homeTeamAbbr: string | null;
  awayScore: number | null;
  homeScore: number | null;
  isFinal: boolean;
  isLive: boolean;
  odds: { awayMoneyline: number; homeMoneyline: number; overUnder: number | null } | null;
};

export type SiteOpenTeam = {
  id: string;
  name: string;
  abbreviation: string | null;
  mascot: string | null;
};

export type SiteLeagueConferenceReassignment = {
  abbreviation: string;
  name: string;
  fromConference: string;
  toConference: string;
};

export type SiteLeagueSearchHit = {
  id: string;
  name: string;
  logoUrl: string | null;
  templateId: string | null;
  game: string;
  gameLabel: string;
  seasonStage: string;
  seasonStageLabel: string;
  seasonNumber: number;
  currentWeek: number | null;
  openTeamCount: number;
  memberCount: number;
  commissionerUsername: string | null;
  isMember: boolean;

  coinEconomyEnabled: boolean;
  economyPayoutsActive: boolean;
  economyLinkedUserCount: number;
  economyMinimumLinkedUsers: number;
  economyMembersShort: number;
  advanceTiming: string | null;
  advanceTimingOther: string | null;
  regularSeasonStreamingRequirement: string | null;
  postseasonStreamingRequirement: string | null;
  streamingRequirement: string | null;
  regularSeasonStreamingSide: string | null;
  postseasonStreamingSide: string | null;
  customCoachesRequired: boolean;
  customPlaybooksAllowed: boolean;
  difficulty: string | null;
  slidersAdjusted: boolean;
  quarterLengthMinutes: number | null;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number | null;
  injuryPolicy: string | null;
  wearAndTearEnabled: boolean;
  fourthDownRuleTypeRegular: string | null;
  fourthDownRuleTypePlayoff: string | null;
  coachFiringPolicy: string | null;
  preorderBonusesEnabled: boolean;
  ballHawk: string | null;
  heatSeeker: string | null;
  switchAssist: string | null;
  offensivePlayCallLimitsEnabled: boolean;
  offensivePlayCallLimit: number | null;
  offensivePlayCallCooldownEnabled: boolean;
  offensivePlayCallCooldown: number | null;
  defensivePlayCallLimitsEnabled: boolean;
  defensivePlayCallLimit: number | null;
  defensivePlayCallCooldownEnabled: boolean;
  defensivePlayCallCooldown: number | null;
  fairSimRequirements: string | null;
  forceWinRequirements: string | null;

  customPlayersEnabled: boolean;
  legendsEnabled: boolean;
  devUpgradesEnabled: boolean;
  ageResetsEnabled: boolean;
  attributePurchasesEnabled: boolean;
  playerTraitPurchasesEnabled: boolean;
  contractAdjustmentPurchasesEnabled: boolean;

  rosterType: string | null;
  coachAbilitiesRestricted: boolean;
  coachAbilitiesRestrictionNotes: string | null;
  tradeApprovalPolicy: string | null;
  cpuTradingPolicy: string | null;
  cpuTradingRestriction: string | null;
  salaryCapEnabled: boolean;
  abilitiesEnabled: boolean;
  tradeDeadlineEnabled: boolean;
  positionChangePolicy: string | null;
  positionChangePolicyDescription: string | null;

  coachModeEnabled: boolean;
  activeRostersEnabled: boolean | null;
  dynastyType: string | null;
  conferenceRealignment: string | null;
  conferenceReassignments: SiteLeagueConferenceReassignment[];
  recruitingDifficulty: string | null;
  coachXpSetting: string | null;
  transferPortalEnabled: boolean | null;
  homeFieldAdvantageEnabled: boolean | null;
  coachCarouselEnabled: boolean | null;
  stadiumPulseEnabled: boolean | null;
  coachModeRecruitFlippingEnabled: boolean | null;
  coachModeAutoRecruitingEnabled: boolean | null;
  coachModeAutoProgressPlayersEnabled: boolean | null;
  coachModeUserAutoProgressionEnabled: boolean | null;
  coachModeCpuManageBudgetEnabled: boolean | null;
  coachModeCpuManageStaffEnabled: boolean | null;
  coachModeCpuManageFacilitiesEnabled: boolean | null;
  crossPlayEnabled: boolean;
  requiredConsole: string | null;
};

export type SiteLeagueSearchFilters = {
  q?: string;
  game?: string;
  openTeamAbbr?: string;
  difficulty?: string;
  streamingRequirement?: string;
  coinEconomyEnabled?: boolean;
  acceleratedClockEnabled?: boolean;
  tradeApprovalPolicy?: string;
  offensivePlayCallLimitsEnabled?: boolean;
  defensivePlayCallLimitsEnabled?: boolean;
  rosterType?: string;
  templateId?: string;
  sort?: "name_asc" | "name_desc" | "open_teams" | "newest";
  limit?: number;
};

export type SiteNotificationItem = {
  id: string;
  title: string;
  body: string | null;
  href: string;
  read: boolean;
  createdAt: string;
  kind: "regular" | "commissioner";
  leagueId?: string | null;
  leagueName?: string | null;
};

export type SiteActivityCounts = {
  unreadMessages: number;
  unreadNotifications: number;
  unreadCommissionerItems: number;
};

export const siteApi = {
  getLinkProfile() {
    return request<LinkProfileResponse>("/v1/site-auth/me", {});
  },
  getStreamingAccounts() {
    return request<StreamingAccountsResponse>("/v1/streaming/accounts", {});
  },
  startStreamingOAuth(platform: StreamPlatform) {
    return request<{ url: string }>("/v1/streaming/oauth/start", { platform });
  },
  linkStreamingUsername(platform: StreamPlatform, username: string) {
    return request<StreamingAccountsResponse>("/v1/streaming/accounts/username", { platform, username });
  },
  linkTiktokUsername(username: string) {
    return this.linkStreamingUsername("tiktok", username);
  },
  unlinkStreamingAccount(platform: StreamPlatform) {
    return request<StreamingAccountsResponse>("/v1/streaming/accounts/unlink", { platform });
  },
  unlinkDiscord() {
    return request<LinkProfileResponse>("/v1/site-auth/link/discord-unlink", {});
  },
  listStreamingMatchups() {
    return request<{ matchups: StreamingMatchupOption[] }>("/v1/streaming/h2h-matchups", {});
  },
  getLiveStreamPrompt() {
    return request<{
      prompt: { id: string; status: string; selected_game_id: string | null } | null;
      matchups: StreamingMatchupOption[];
      session: { id: string; platform: string; stream_url: string } | null;
    }>("/v1/streaming/live-prompt", {});
  },
  respondLiveStreamPrompt(input: { promptId: string; action: "confirm" | "decline"; gameId?: string | null }) {
    return request<{ confirmed?: boolean; declined?: boolean }>("/v1/streaming/live-prompt/respond", input);
  },
  linkDiscordOAuth() {
    return request<
      LinkProfileResponse & { lifetimePlatinum: boolean; discordLinked: boolean; isNewDiscordLink: boolean }
    >("/v1/site-auth/link/discord-oauth", {});
  },
  ensureAccount() {
    return request<{ userId: string; isNew: boolean }>("/v1/site-auth/ensure-account", {});
  },
  listLinkCandidates(input: { query?: string; limit?: number; offset?: number }) {
    return request<LinkCandidatesResponse>("/v1/site-auth/link/candidates", input);
  },
  requestIdentityClaimCode(discordAccountId: string) {
    return request<{
      sent: boolean;
      discordUsername: string;
      expiresInSeconds: number;
    }>("/v1/site-auth/link/request-code", { discordAccountId });
  },
  verifyIdentityClaimCode(discordAccountId: string, code: string) {
    return request<LinkProfileResponse>("/v1/site-auth/link/verify", {
      discordAccountId,
      code,
    });
  },
  setUsername(username: string) {
    return request<LinkProfileResponse>("/v1/site-auth/username/set", { username });
  },
  checkUsername(username: string) {
    return request<{ available: boolean; reason: string | null }>(
      "/v1/site-auth/username/check",
      { username },
    );
  },
  getEntitlements() {
    return request<EntitlementSummary>("/v1/subscriptions/me", {});
  },
  createCheckout(tier: "gold" | "platinum", interval: "month" | "year" = "month") {
    const origin = window.location.origin;
    return request<{ url: string }>("/v1/subscriptions/checkout", {
      tier,
      interval,
      successUrl: `${origin}/pricing?checkout=success`,
      cancelUrl: `${origin}/pricing?checkout=cancel`,
    });
  },
  // Guest checkout: no session required, and no account is created until the payment is
  // confirmed and redeemed/attached below — a declined card leaves nothing behind.
  createPublicCheckout(tier: "gold" | "platinum", interval: "month" | "year" = "month") {
    return publicRequest<{ url: string; sessionId: string }>("/v1/subscriptions/checkout/public", {
      method: "POST",
      body: JSON.stringify({ tier, interval }),
    });
  },
  redeemCheckoutSession(sessionId: string) {
    return publicRequest<{ paid: boolean; email: string | null; tier: "gold" | "platinum"; interval: "month" | "year" }>(
      "/v1/subscriptions/checkout/redeem",
      { method: "POST", body: JSON.stringify({ sessionId }) },
    );
  },
  attachCheckoutSession(sessionId: string) {
    return request<EntitlementSummary>("/v1/subscriptions/checkout/attach", { sessionId });
  },
  openBillingPortal() {
    const origin = window.location.origin;
    return request<{ url: string }>("/v1/subscriptions/portal", {
      returnUrl: `${origin}/account`,
    });
  },
  listClaimableLeagues() {
    return request<{
      leagues: Array<{
        id: string;
        name: string;
        game: string;
        frozenAt: string | null;
        previousOwnerUserId: string | null;
      }>;
    }>("/v1/subscriptions/claimable-leagues", {});
  },
  claimLeagueOwnership(leagueId: string) {
    return request<{
      league: { id: string; name: string; game: string; ownerUserId: string };
    }>(`/v1/subscriptions/leagues/${leagueId}/claim-ownership`, {});
  },
  getRegistrationGate() {
    return publicRequest<RegistrationGate>("/v1/subscriptions/registration-gate");
  },
  getBotInviteUrl(guildId?: string) {
    return publicRequest<{ inviteUrl: string }>("/v1/subscriptions/bot/invite-url", {
      method: "POST",
      body: JSON.stringify(guildId ? { guildId } : {}),
    });
  },
  listDiscordGuilds(providerToken: string) {
    return request<{ guilds: Array<{ id: string; name: string; icon: string | null }> }>(
      "/v1/site-auth/discord-guilds",
      { providerToken },
    );
  },
  // Replacement for the old invite-token + /claim-league round-trip: creates the server +
  // primary league link immediately, using the same fresh "guilds"-scoped Discord OAuth token
  // already used to list the picker's guild options — no separate in-Discord step required.
  linkLeagueToServer(input: { leagueId: string; providerToken: string; guildId: string; serverName?: string }) {
    return request<{ linked: true; server: { id: string; name: string } }>("/v1/site-leagues/link-server", input);
  },
  completeDiscordPostInviteSetup(leagueId: string) {
    return request<{
      botJoined: boolean;
      nicknameSet: boolean;
      channels: Array<{ key: string; label: string; configured: boolean; maddenOnly: boolean }>;
    }>("/v1/site-leagues/discord-post-invite", { leagueId });
  },
  enableLeagueBot(leagueId: string) {
    return request<{
      league: {
        id: string;
        discord_bot_enabled: boolean;
        discord_bot_invite_token: string | null;
        discord_bot_invite_created_at: string | null;
      };
    }>(`/v1/subscriptions/leagues/${leagueId}/bot/enable`, {});
  },
  disableLeagueBot(leagueId: string) {
    return request<{
      league: {
        id: string;
        discord_bot_enabled: boolean;
      };
    }>(`/v1/subscriptions/leagues/${leagueId}/bot/disable`, {});
  },
  listFriends() {
    return request<{
      accepted: SiteFriendship[];
      pendingIncoming: SiteFriendship[];
      pendingOutgoing: SiteFriendship[];
    }>("/v1/site-friends/list", {});
  },
  listFriendSuggestions(input: { query?: string; limit?: number } = {}) {
    return request<{
      suggestions: Array<{ userId: string; username: string; displayName: string }>;
    }>("/v1/site-friends/suggestions", input);
  },
  requestFriend(input: { username?: string; userId?: string }) {
    return request<{
      friendshipId: string;
      status: string;
      autoAccepted: boolean;
      peer: { id?: string; userId?: string; username: string; displayName: string };
    }>("/v1/site-friends/request", input);
  },
  respondFriend(friendshipId: string, action: "accept" | "decline") {
    return request<{ friendshipId: string; status: string }>(
      "/v1/site-friends/respond",
      { friendshipId, action },
    );
  },
  removeFriend(input: { friendshipId?: string; userId?: string }) {
    return request<{ ok: true; friendshipId: string }>(
      "/v1/site-friends/remove",
      input,
    );
  },
  listConversations() {
    return request<{ conversations: SiteConversation[] }>(
      "/v1/site-inbox/conversations",
      {},
    );
  },
  searchDmTargets(input: { query?: string; limit?: number }) {
    return request<{ targets: DmTarget[] }>("/v1/site-inbox/dm-targets", input);
  },
  openDm(input: { username?: string; userId?: string }) {
    return request<{
      conversationId: string;
      peer: { userId: string; username: string; displayName: string };
    }>("/v1/site-inbox/conversations/open-dm", input);
  },
  openCommissioner(leagueId: string) {
    return request<{ conversationId: string }>(
      "/v1/site-inbox/conversations/open-commissioner",
      { leagueId },
    );
  },
  listMessages(input: { conversationId: string; limit?: number; before?: string }) {
    return request<{ messages: SiteMessage[] }>("/v1/site-inbox/messages/list", input);
  },
  sendMessage(conversationId: string, body: string) {
    return request<{ message: SiteMessage }>("/v1/site-inbox/messages/send", {
      conversationId,
      body,
    });
  },
  markConversationRead(conversationId: string) {
    return request<{ ok: true }>("/v1/site-inbox/conversations/mark-read", {
      conversationId,
    });
  },
  reportMessage(messageId: string) {
    return request<{ ok: true }>("/v1/site-inbox/messages/report", { messageId });
  },
  listMyLeagues() {
    return request<{ leagues: SiteLeagueSummary[] }>("/v1/site-leagues/mine", {});
  },
  searchLeagues(filters: SiteLeagueSearchFilters = {}) {
    return request<{ leagues: SiteLeagueSearchHit[] }>("/v1/site-leagues/search", filters);
  },
  listOpenLeagueTeams(leagueId: string) {
    return request<{ teams: SiteOpenTeam[]; pendingTeamId: string | null }>(
      "/v1/site-leagues/open-teams",
      { leagueId },
    );
  },
  requestLeagueTeam(leagueId: string, teamId: string) {
    return request<{ ok: true; requestId: string }>("/v1/site-leagues/request-team", {
      leagueId,
      teamId,
    });
  },
  searchInviteTargets(input: { query?: string; limit?: number } = {}) {
    return request<{ users: Array<{ userId: string; username: string; displayName: string }> }>(
      "/v1/site-league-invites/search",
      input,
    );
  },
  sendLeagueInvite(input: {
    leagueId: string;
    userId?: string;
    username?: string;
    message?: string;
  }) {
    return request<{
      inviteId: string;
      status: string;
      createdAt: string;
      peer: { userId: string; username: string; displayName: string };
    }>("/v1/site-league-invites/send", input);
  },
  listLeagueInvites(leagueId: string) {
    return request<{ invites: SiteLeagueInvite[] }>("/v1/site-league-invites/list", {
      leagueId,
    });
  },
  listPendingInvites() {
    return request<{ invites: SiteLeagueInvitePending[] }>("/v1/site-league-invites/mine", {});
  },
  respondLeagueInvite(inviteId: string, action: "accept" | "decline") {
    return request<{ ok: true; status: string }>("/v1/site-league-invites/respond", {
      inviteId,
      action,
    });
  },
  openLeagueHub(input: {
    leagueId: string;
    view?: "buzz" | "matchups" | "team" | "store" | "mgmt";
    embed?: boolean;
  }) {
    return request<{
      guildId: string;
      discordId: string;
      leagueId: string;
      /** Present for older site bundles that still iframe the web hub. */
      hubUrl?: string | null;
    }>("/v1/site-leagues/open-hub", input);
  },
  retireFromLeague(leagueId: string) {
    return request<{ ok: true }>("/v1/site-leagues/retire", { leagueId });
  },
  getLeagueTicker(leagueId: string) {
    return request<{ items: SiteLeagueTickerItem[]; weekNumber: number }>(
      "/v1/site-leagues/ticker",
      { leagueId },
    );
  },
  listNotifications() {
    return request<{
      regular: SiteNotificationItem[];
      commissioner: SiteNotificationItem[];
      unreadCount: number;
    }>("/v1/site-notifications/list", {});
  },
  getActivityCounts() {
    return request<SiteActivityCounts>("/v1/site-notifications/counts", {});
  },
  markNotificationsRead(ids: string[]) {
    return request<{ ok: true; updated: number }>(
      "/v1/site-notifications/mark-read",
      { ids },
    );
  },
  clearNotifications() {
    return request<{ ok: true; cleared: number }>("/v1/site-notifications/clear", {});
  },
  markCommissionerLeaguesViewed(leagueIds: string[]) {
    return request<{ ok: true }>("/v1/site-notifications/mark-commissioner-viewed", {
      leagueIds,
    });
  },
  exchangeAppHandoff(handoff: string) {
    return request<
      | {
          status: "ready";
          sitePath: string;
          leagueId: string | null;
          guildId: string;
        }
      | { status: "need_setup"; reason: "link_identity" | "username"; message: string }
    >("/v1/web-session/handoff/exchange", { handoff });
  },
  listHighlightGames(leagueId: string) {
    return request<{
      weekNumber: number;
      seasonNumber: number;
      seasonStage: string;
      games: Array<{ gameId: string; weekNumber: number; label: string }>;
    }>("/v1/site-highlights/games", { leagueId });
  },
  createHighlightDirectUpload(input: { leagueId: string; gameId: string; fileName?: string }) {
    return request<{
      highlightId: string;
      uploadURL: string;
      streamUid: string;
      maxDurationSeconds: number;
      maxHeight: number;
    }>("/v1/site-highlights/direct-upload", input);
  },
  markHighlightUploadReceived(input: { leagueId: string; highlightId: string }) {
    return request<{ highlightId: string; mediaStatus: string }>(
      "/v1/site-highlights/upload-received",
      input,
    );
  },
  getHighlightUploadStatus(input: { leagueId: string; highlightId: string }) {
    return request<{
      highlightId: string;
      mediaStatus: string;
      playbackUrl: string | null;
      streamUid: string | null;
      iframeUrl: string | null;
      failureReason?: string | null;
    }>("/v1/site-highlights/status", input);
  },
  listPendingHighlights(leagueId: string) {
    return request<{
      items: Array<{
        inboxId: string;
        reviewId: string;
        header: string;
        summary: string;
        amount: number;
        createdAt: string;
        uploaderName: string;
        mediaStatus: string | null;
        playbackUrl: string | null;
        iframeUrl: string | null;
        streamUid: string | null;
      }>;
    }>("/v1/site-highlights/pending", { leagueId });
  },
  reviewHighlight(input: {
    leagueId: string;
    reviewId: string;
    action: "approve" | "deny";
    deniedReason?: string;
  }) {
    return request<{ updated: boolean; reason?: string }>(
      "/v1/site-highlights/review",
      input,
    );
  },
  getHomeCard() {
    return request<SiteHomeCard>("/v1/site-home/card", {});
  },
  listSiteAnnouncements() {
    return request<{ announcements: SiteAnnouncement[] }>("/v1/site-home/announcements", {});
  },
  getSpotlightReel() {
    return request<SpotlightReelResponse>("/v1/site-home/spotlight", {});
  },
  reactSpotlight(input: { highlightId: string; reactionKey: "like" | "dislike" }) {
    return request<SpotlightReelResponse>("/v1/site-home/spotlight/react", input);
  },
  commentSpotlight(input: { highlightId: string; body: string }) {
    return request<{
      comment: {
        id: string;
        body: string;
        createdAt: string;
        author: { displayName: string; username: string | null };
      };
    }>("/v1/site-home/spotlight/comment", input);
  },
  listCareerStatsByGame() {
    return request<{
      games: Array<{
        game: string;
        gameLabel: string;
        gamesLogged: number;
        passingYards: number;
        rushingYards: number;
        totalYards: number;
        firstDowns: number;
        turnoversGenerated: number;
        turnoversCommitted: number;
        turnoverDifferential: number;
      }>;
    }>("/v1/site-home/career-stats", {});
  },
  getPushPublicKey() {
    return publicRequest<{ publicKey: string | null }>("/v1/push/public-key");
  },
  subscribeToPush(input: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return request<{ ok: true }>("/v1/push/subscribe", input);
  },
  unsubscribeFromPush(endpoint: string) {
    return request<{ ok: true }>("/v1/push/unsubscribe", { endpoint });
  },
  getAdminStatus() {
    return request<{ isAdmin: boolean }>("/v1/admin/whoami", {});
  },
  getAdminDiscordConfig() {
    return request<AdminDiscordConfig>("/v1/admin/discord-config/get", {});
  },
  updateAdminDiscordConfig(patch: { managementGuildId?: string | null; leaguePostChannels?: Partial<AdminDiscordConfig["leaguePostChannels"]> }) {
    return request<AdminDiscordConfig>("/v1/admin/discord-config/set", patch);
  },
  syncAdminDiscordRecruitingAds() {
    return request<{ synced: string[] }>("/v1/admin/discord-config/sync-ads", {});
  },
  sendAdminUserMessage(input: { userId: string; title: string; body: string }) {
    return request<{ channel: "discord" | "site" }>("/v1/admin/users/message", input);
  },
  getLeagueCreatorStatus() {
    return request<{ allowed: boolean }>("/v1/site-leagues/create/whoami", {});
  },
  createLeague(input: { name: string; game: "madden_26" | "madden_27" | "cfb_27"; leagueType?: string; activeRostersEnabled?: boolean; trackRostersEnabled?: boolean; [key: string]: unknown }) {
    return request<{ league: { id: string; name: string; game: string } }>("/v1/site-leagues/create", input);
  },
  async uploadLeagueLogo(leagueId: string, file: File) {
    const base = requireApiBaseUrl();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You are not signed in.");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${base}/v1/site-leagues/upload-logo?leagueId=${encodeURIComponent(leagueId)}`, {
      method: "POST", headers: { authorization: `Bearer ${session.access_token}` }, body: form,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? "Logo upload failed.");
    return payload as { logoUrl: string };
  },
  updateLeagueConfig(leagueId: string, config: Record<string, unknown>) {
    return request<{ configuration: unknown }>("/v1/site-leagues/update-config", { leagueId, ...config });
  },
  checkLeagueLinked(leagueId: string) {
    return request<{ linked: boolean; guildId: string | null; serverName: string | null }>("/v1/site-leagues/check-linked", { leagueId });
  },
  completeWizard(input: { leagueId: string; teamId?: string; guildId?: string; discordId?: string }) {
    return request<{ ok: boolean; team: any | null; assignment: any | null }>("/v1/site-leagues/complete-wizard", input);
  },
  linkLeagueServer(input: { leagueId: string; providerToken: string; guildId: string; serverName?: string }) {
    return request<{
      linked: boolean;
      server: { id: string; name: string } | null;
    }>("/v1/site-leagues/link-server", input);
  },
  getAdminStats() {
    return request<AdminStats>("/v1/admin/stats", {});
  },
  listAdminIncidents(input: { status?: string; severity?: string; leagueId?: string; process?: string; limit?: number } = {}) {
    return request<{ incidents: AdminIncident[] }>("/v1/admin/incidents/list", input);
  },
  getAdminIncidentPatterns() {
    return request<IncidentPatternSummary>("/v1/admin/incidents/patterns", {});
  },
  resolveAdminIncident(incidentId: string) {
    return request<{ id: string; status: string }>("/v1/admin/incidents/resolve", { incidentId });
  },
  resolveAllAdminIncidents(process?: string) {
    return request<{ resolvedCount: number }>("/v1/admin/incidents/resolve-all", process ? { process } : {});
  },
  ignoreAdminIncident(incidentId: string) {
    return request<{ id: string; status: string }>("/v1/admin/incidents/ignore", { incidentId });
  },
  startAdminIncidentWorkorder(input: { incidentId: string; conversationId: string; note?: string | null }) {
    return request<{ id: string; workorder_status: string; workorder_conversation_id: string }>("/v1/admin/incidents/start-workorder", input);
  },
  closeAdminIncidentWorkorder(incidentId: string) {
    return request<{ id: string; workorder_status: string; status: string }>("/v1/admin/incidents/close-workorder", { incidentId });
  },
  listAdminAnnouncements() {
    return request<{ announcements: AdminAnnouncement[] }>("/v1/admin/announcements/list", {});
  },
  createAdminAnnouncement(input: {
    title: string;
    body: string;
    href?: string | null;
    published?: boolean;
    sortOrder?: number;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    return request<{ announcement: AdminAnnouncement }>("/v1/admin/announcements/create", input);
  },
  updateAdminAnnouncement(input: {
    id: string;
    title?: string;
    body?: string;
    href?: string | null;
    published?: boolean;
    sortOrder?: number;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    return request<{ announcement: AdminAnnouncement }>("/v1/admin/announcements/update", input);
  },
  deleteAdminAnnouncement(id: string) {
    return request<{ ok: true }>("/v1/admin/announcements/delete", { id });
  },
  listAdminLeagues(input: { query?: string; limit?: number } = {}) {
    return request<{ leagues: AdminLeagueSummary[] }>("/v1/admin/leagues/list", input);
  },
  listAdminLeagueMembers(leagueId: string) {
    return request<{ members: AdminLeagueMember[] }>("/v1/admin/leagues/members", { leagueId });
  },
  removeAdminLeagueMember(input: { leagueId: string; userId: string }) {
    return request<{ ok: true }>("/v1/admin/leagues/remove-member", input);
  },
  deleteAdminLeague(input: { leagueId: string; confirmationText: string }) {
    return request<{ ok: true; leagueName: string }>("/v1/admin/leagues/delete", input);
  },
  searchAdminUsers(input: { query?: string; limit?: number } = {}) {
    return request<{ users: AdminUserSummary[] }>("/v1/admin/users/search", input);
  },
  listRecentAdminUsers() {
    return request<{ users: AdminUserSummary[] }>("/v1/admin/users/recent", {});
  },
  grantUserTier(input: { userId: string; tier: "gold" | "platinum" | "none" }) {
    return request<{ userId: string; subscriptionTier: string; billingStatus: string }>("/v1/admin/users/grant-tier", input);
  },
  grantUserCoins(input: { userId: string; amount: number }) {
    return request<{ userId: string; amount: number; ledgerId: string; walletBalance: number | null }>(
      "/v1/admin/users/grant-coins",
      input,
    );
  },
  deactivateUser(input: { userId: string }) {
    return request<{ userId: string; deactivated: true; endedAssignments: number }>("/v1/admin/users/deactivate", input);
  },
  impersonateUser(userId: string) {
    return request<{ accessToken: string; refreshToken: string; targetUsername: string | null }>(
      "/v1/admin/impersonate",
      { userId },
    );
  },
  listPromoCodes() {
    return request<{ codes: PromoCode[] }>("/v1/admin/promo-codes/list", {});
  },
  createPromoCode(input: {
    code: string;
    description?: string | null;
    effectType: PromoCodeEffectType;
    effectValue?: number | null;
    maxRedemptions?: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    return request<PromoCode>("/v1/admin/promo-codes/create", input);
  },
  updatePromoCode(input: {
    id: string;
    code?: string;
    description?: string | null;
    effectType?: PromoCodeEffectType;
    effectValue?: number | null;
    maxRedemptions?: number | null;
    active?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    return request<PromoCode>("/v1/admin/promo-codes/update", input);
  },
  deletePromoCode(id: string) {
    return request<{ ok: true }>("/v1/admin/promo-codes/delete", { id });
  },
  redeemPromoCode(code: string) {
    return request<{ effectType: PromoCodeEffectType; description: string | null }>("/v1/promo-codes/redeem", { code });
  },
  listRankedGames() {
    return request<{ games: Array<{ game: string; label: string; dynastyLabel: string }> }>("/v1/rankings/games", {});
  },
  listPowerRankings(input: { game: string; scope: "dynasty" | "comp" }) {
    return request<{ rankings: PowerRankingRow[]; asOf: string | null }>("/v1/rankings/list", input);
  },
  listTournaments() {
    return request<{ tournaments: SiteTournamentSummary[]; isAdmin: boolean }>("/v1/tournaments/list", {});
  },
  listTournamentTicker() {
    return request<{ items: SiteTournamentSummary[] }>("/v1/tournaments/ticker", {});
  },
  listMyTournaments() {
    return request<{ cards: SiteTournamentHomeCard[] }>("/v1/tournaments/mine", {});
  },
  getTournament(tournamentId: string) {
    return request<SiteTournamentDetail & { isAdmin: boolean; knownGamerTag: string | null; teams: SiteTournamentTeamOption[] }>(
      "/v1/tournaments/get",
      { tournamentId },
    );
  },
  createTournament(input: {
    title: string;
    description?: string | null;
    game: "madden_26" | "madden_27" | "cfb_27";
    bracketType: string;
    payoutScope: "winner" | "final_two" | "final_four";
    winnerCoins: number;
    runnerUpCoins?: number;
    semifinalistCoins?: number;
    registrationOpensAt: string;
    registrationClosesAt: string;
    kickoffAt: string;
    timezone?: string;
    rules: TournamentRules;
    rosterLibraryId?: string | null;
    teamSelectionMode?: "typed" | "claim_pool";
    claimOrderMode?: "first_come" | "lottery" | null;
    scheduleMode?: "single_kickoff" | "per_round";
  }) {
    return request<{ tournament: SiteTournamentSummary }>("/v1/tournaments/create", input);
  },
  updateTournament(input: {
    tournamentId: string;
    title?: string;
    description?: string | null;
    payoutScope?: "winner" | "final_two" | "final_four";
    winnerCoins?: number;
    runnerUpCoins?: number;
    semifinalistCoins?: number;
    registrationOpensAt?: string;
    registrationClosesAt?: string;
    kickoffAt?: string;
    timezone?: string;
    rules?: TournamentRules;
    rosterLibraryId?: string | null;
    teamSelectionMode?: "typed" | "claim_pool";
    claimOrderMode?: "first_come" | "lottery" | null;
    scheduleMode?: "single_kickoff" | "per_round";
    schedulingWindowHours?: number;
  }) {
    return request<{ tournament: SiteTournamentSummary }>("/v1/tournaments/update", input);
  },
  async uploadTournamentLogo(tournamentId: string, file: File) {
    const base = requireApiBaseUrl();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You are not signed in.");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${base}/v1/tournaments/upload-logo?tournamentId=${encodeURIComponent(tournamentId)}`, {
      method: "POST", headers: { authorization: `Bearer ${session.access_token}` }, body: form,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? "Logo upload failed.");
    return payload as { logoUrl: string };
  },
  listTournamentRounds(tournamentId: string) {
    return request<{ rounds: Array<{ bracketSide: "winners" | "losers" | "grand_final"; round: number; scheduledAt: string | null }> }>(
      "/v1/tournaments/rounds/list",
      { tournamentId },
    );
  },
  setTournamentRoundSchedule(input: { tournamentId: string; bracketSide: "winners" | "losers" | "grand_final"; round: number; scheduledAt: string }) {
    return request<{ rounds: Array<{ bracketSide: "winners" | "losers" | "grand_final"; round: number; scheduledAt: string | null }> }>(
      "/v1/tournaments/rounds/schedule",
      input,
    );
  },
  proposeTournamentMatchTime(input: { matchId: string; proposedForUtc: string }) {
    return request<{ id: string; status: string }>("/v1/tournaments/scheduling/propose", input);
  },
  respondToTournamentMatchProposal(input: {
    matchId: string;
    proposalId: string;
    action: "accept" | "counter" | "withdraw" | "reject";
    counterForUtc?: string;
  }) {
    return request<{ status: string }>("/v1/tournaments/scheduling/respond", input);
  },
  requestTournamentMatchReschedule(matchId: string) {
    return request<{ status: string }>("/v1/tournaments/scheduling/request-reschedule", { matchId });
  },
  resetTournamentMatchScheduling(matchId: string) {
    return request<{ status: string }>("/v1/tournaments/scheduling/reset", { matchId });
  },
  cancelTournament(tournamentId: string) {
    return request<{ ok: true }>("/v1/tournaments/cancel", { tournamentId });
  },
  lockTournament(tournamentId: string) {
    return request<SiteTournamentDetail>("/v1/tournaments/lock", { tournamentId });
  },
  joinTournament(input: { tournamentId: string; teamAbbr?: string | null; gamerTag: string }) {
    return request<SiteTournamentDetail>("/v1/tournaments/join", input);
  },
  leaveTournament(tournamentId: string) {
    return request<SiteTournamentDetail>("/v1/tournaments/leave", { tournamentId });
  },
  async uploadTournamentScreenshot(file: File) {
    const base = requireApiBaseUrl();
    const token = await requireAccessToken();
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${base}/v1/tournaments/screenshot-upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? "Upload failed.");
    return payload as { url: string };
  },
  reportTournamentWinner(input: {
    tournamentId: string;
    matchId: string;
    winnerUserId: string;
    resultMethod: "final_screenshot" | "concede" | "opponent_quit";
    screenshotUrl: string;
    concededByUserId?: string | null;
    playerAScore?: number | null;
    playerBScore?: number | null;
    boxScore?: SiteTournamentBoxScore | null;
  }) {
    return request<SiteTournamentDetail>("/v1/tournaments/report-winner", input);
  },
  listTournamentMatchReviewQueue() {
    return request<{ queue: SiteTournamentMatchReview[] }>("/v1/tournaments/matches/review-queue", {});
  },
  approveTournamentMatchResult(matchId: string) {
    return request<{ ok: true }>("/v1/tournaments/matches/approve", { matchId });
  },
  rejectTournamentMatchResult(matchId: string) {
    return request<{ ok: true }>("/v1/tournaments/matches/reject", { matchId });
  },
  setTournamentRegistrationOpen(tournamentId: string, open: boolean) {
    return request<{ ok: true; registrationPaused: boolean }>("/v1/tournaments/registration-open", { tournamentId, open });
  },
  setTournamentEventOpen(tournamentId: string, open: boolean) {
    return request<{ ok: true; eventPaused: boolean }>("/v1/tournaments/event-open", { tournamentId, open });
  },
  addTournamentUser(input: {
    tournamentId: string;
    userId: string;
    teamAbbr: string;
    gamerTag: string;
    into: "registration" | "tournament";
  }) {
    return request<SiteTournamentDetail>("/v1/tournaments/add-user", input);
  },
  setTournamentEntryStatus(input: {
    tournamentId: string;
    userId: string;
    entryStatus: "pending" | "approved" | "removed";
  }) {
    return request<SiteTournamentDetail>("/v1/tournaments/set-entry", input);
  },
  setTournamentMatchStream(input: { tournamentId: string; matchId: string; streamUrl: string }) {
    return request<SiteTournamentDetail>("/v1/tournaments/set-stream", input);
  },
  listTournamentHighlights(tournamentId: string) {
    return request<{ highlights: SiteTournamentHighlight[] }>("/v1/tournaments/highlights/list", { tournamentId });
  },
  createTournamentHighlightDirectUpload(input: { tournamentId: string; matchId: string; fileName?: string }) {
    return request<{
      highlightId: string;
      uploadURL: string;
      streamUid: string;
      maxDurationSeconds: number;
      maxHeight: number;
    }>("/v1/tournaments/highlights/direct-upload", input);
  },
  markTournamentHighlightUploadReceived(input: { tournamentId: string; highlightId: string }) {
    return request<{ highlightId: string; mediaStatus: string }>(
      "/v1/tournaments/highlights/upload-received",
      input,
    );
  },
  getTournamentHighlightUploadStatus(input: { tournamentId: string; highlightId: string }) {
    return request<{
      highlightId: string;
      mediaStatus: string;
      playbackUrl: string | null;
      streamUid: string | null;
      iframeUrl: string | null;
      failureReason?: string | null;
    }>("/v1/tournaments/highlights/status", input);
  },
  reviewTournamentHighlight(highlightId: string, status: "approved" | "rejected") {
    return request<{ highlights: SiteTournamentHighlight[] }>("/v1/tournaments/highlights/review", { highlightId, status });
  },
  getTournamentWagerOptions(input: { tournamentId: string; matchId: string }) {
    return request<SiteTournamentWagerOptions>("/v1/tournaments/wagers/options", input);
  },
  listTournamentWagers(tournamentId: string, matchId?: string) {
    return request<{
      wagers: SiteTournamentWager[];
      caps: { house: number; peer: number; h2h?: number };
    }>("/v1/tournaments/wagers/list", { tournamentId, matchId });
  },
  placeTournamentWager(input: {
    tournamentId: string;
    matchId: string;
    wagerKind: "house" | "peer";
    marketKey: string;
    pick: string;
    stake: number;
    isParlay?: boolean;
    legs?: Array<{ marketKey: string; pick: string }>;
  }) {
    return request<{ wagers: SiteTournamentWager[] }>("/v1/tournaments/wagers/place", input);
  },
  acceptTournamentWager(wagerId: string) {
    return request<{ wagers: SiteTournamentWager[] }>("/v1/tournaments/wagers/accept", { wagerId });
  },
  setTournamentMatchBetting(input: { tournamentId: string; matchId: string; open: boolean }) {
    return request<{ ok: true; bettingOpen: boolean }>("/v1/tournaments/wagers/betting-open", input);
  },
  listRosterLibraries(game?: "madden_26" | "madden_27" | "cfb_27") {
    return request<{ libraries: SiteRosterLibrary[] }>("/v1/tournaments/roster-libraries/list", { game });
  },
  getRosterLibrary(libraryId: string) {
    return request<{ library: SiteRosterLibrary; teams: SiteRosterLibraryTeam[] }>("/v1/tournaments/roster-libraries/get", { libraryId });
  },
  createRosterLibrary(input: { game: "madden_26" | "madden_27" | "cfb_27"; name: string; sourceNote?: string | null }) {
    return request<{ library: SiteRosterLibrary }>("/v1/tournaments/roster-libraries/create", input);
  },
  importRosterLibraryCsv(input: { libraryId: string; csvText: string }) {
    return request<{ imported: number; skipped: Array<{ row: number; reason: string }> }>("/v1/tournaments/roster-libraries/import", input);
  },
  beginLibraryEaLogin(libraryId: string) {
    return request<{ loginUrl: string; expiresInSeconds: number }>("/v1/tournaments/roster-libraries/ea/login", { libraryId });
  },
  submitLibraryEaCode(input: { libraryId: string; pasted: string }) {
    return request<{ pendingAuthId: string; personas: SiteLibraryEaPersona[] }>("/v1/tournaments/roster-libraries/ea/code", input);
  },
  selectLibraryEaPersona(input: { libraryId: string; pendingAuthId: string; personaId: number }) {
    return request<SiteLibraryEaConnection>("/v1/tournaments/roster-libraries/ea/persona", input);
  },
  getLibraryEaConnectionStatus(libraryId: string) {
    return request<{ connection: SiteLibraryEaConnection | null }>("/v1/tournaments/roster-libraries/ea/status", { libraryId });
  },
  listLibraryEaLeagues(libraryId: string) {
    return request<{ leagues: SiteLibraryEaFranchise[] }>("/v1/tournaments/roster-libraries/ea/leagues", { libraryId });
  },
  bindLibraryEaLeague(input: { libraryId: string; eaLeagueId: number }) {
    return request<SiteLibraryEaConnection>("/v1/tournaments/roster-libraries/ea/bind", input);
  },
  importLibraryRosters(libraryId: string) {
    return request<{ imported: number; skipped: Array<{ team: string; reason: string }> }>("/v1/tournaments/roster-libraries/ea/import", { libraryId });
  },
  cloneRosterLibrary(input: { libraryId: string; newName: string }) {
    return request<{ libraryId: string }>("/v1/tournaments/roster-libraries/clone", input);
  },
  setRosterLibraryBaseline(input: { libraryId: string; isBaseline: boolean }) {
    return request<{ ok: true }>("/v1/tournaments/roster-libraries/set-baseline", input);
  },
  deleteRosterLibrary(libraryId: string) {
    return request<{ ok: true }>("/v1/tournaments/roster-libraries/delete", { libraryId });
  },
  getTournamentLottery(tournamentId: string) {
    return request<SiteTournamentLottery>("/v1/tournaments/lottery/get", { tournamentId });
  },
  scheduleTournamentLottery(input: { tournamentId: string; scheduledAt: string }) {
    return request<SiteTournamentLottery>("/v1/tournaments/lottery/schedule", input);
  },
  runTournamentLotteryNow(tournamentId: string) {
    return request<SiteTournamentLottery>("/v1/tournaments/lottery/run-now", { tournamentId });
  },
  pickLotteryTeam(input: { tournamentId: string; teamAbbr: string; gamerTag: string }) {
    return request<SiteTournamentLottery>("/v1/tournaments/lottery/pick", input);
  },
  assignLotteryTeam(input: { tournamentId: string; userId: string; teamAbbr: string; gamerTag: string }) {
    return request<SiteTournamentLottery>("/v1/tournaments/lottery/assign", input);
  },
  skipLotteryPick(tournamentId: string) {
    return request<SiteTournamentLottery>("/v1/tournaments/lottery/skip", { tournamentId });
  },
  listCompUsers(input: { page?: number } = {}) {
    return request<{ users: CompUserSummary[]; page: number; pageSize: number; total: number }>(
      "/v1/comp/users/list",
      input,
    );
  },
  getCompUserDetail(userId: string) {
    return request<CompUserDetail>("/v1/comp/users/detail", { userId });
  },
  getCompProfile() {
    return request<any>("/v1/comp/profile/get", {});
  },
  saveCompProfile(input: { console: "xbox" | "ps5" | "pc"; gamerTag: string; crossPlayEnabled: boolean; preferredGame: "madden_26" | "madden_27" | "cfb_27" }) {
    return request<any>("/v1/comp/profile/save", input);
  },
  getCompState(game: string) {
    return request<any>("/v1/comp/state", { game });
  },
  joinCompQueue(input: any) {
    return request<any>("/v1/comp/queue/join", input);
  },
  leaveCompQueue() {
    return request<any>("/v1/comp/queue/leave", {});
  },
  requestCompMatch(opponentUserId: string) {
    return request<any>("/v1/comp/match/request", { opponentUserId });
  },
  respondCompMatch(matchId: string, accept: boolean) {
    return request<any>("/v1/comp/match/respond", { matchId, accept });
  },
  listCompTeams(game: string) {
    return request<{ teams: Array<{ id: string; name: string; abbreviation: string | null }> }>("/v1/comp/match/teams", { game });
  },
  selectCompTeam(matchId: string, teamId: string) {
    return request<any>("/v1/comp/match/select-team", { matchId, teamId });
  },
  sendCompMessage(matchId: string, body: string) {
    return request<any>("/v1/comp/chat/send", { matchId, body });
  },
  shareCompStream(matchId: string, streamUrl: string) {
    return request<any>("/v1/comp/stream/share", { matchId, streamUrl });
  },
  cancelCompMatch(matchId: string) {
    return request<any>("/v1/comp/match/cancel", { matchId });
  },
  concedeCompMatch(matchId: string) {
    return request<any>("/v1/comp/match/concede", { matchId });
  },
  createCompReport(input: any) {
    return request<any>("/v1/comp/report/create", input);
  },
  respondCompReport(input: any) {
    return request<any>("/v1/comp/report/respond", input);
  },
  parseCompBoxScore(input: { game: string; imageUrls: string[] }) {
    return request<any>("/v1/comp/box-score/parse", input);
  },
  submitCompBoxScore(input: any) {
    return request<any>("/v1/comp/box-score/submit", input);
  },
  reviewCompBoxScore(input: any) {
    return request<any>("/v1/comp/box-score/review", input);
  },
  async uploadCompImage(file: File) {
    const base = requireApiBaseUrl();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You are not signed in.");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${base}/v1/comp/box-score/upload`, {
      method: "POST", headers: { authorization: `Bearer ${session.access_token}` }, body: form,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? "Upload failed.");
    return payload as { url: string };
  },
  listDemoLeagues() {
    return publicRequest<{ leagues: Array<{ id: string; name: string; game: string; seasonNumber: number; phases: Array<{ value: DemoPhase; label: string }> }> }>("/v1/demo-league/leagues", { method: "POST" });
  },
  listDemoTeams(leagueId: string) {
    return publicRequest<{ league: { id: string; name: string; game: string }; teams: Array<{ id: string; name: string; abbr: string | null; conference: string | null; coachName: string }> }>(
      "/v1/demo-league/teams", { method: "POST", body: JSON.stringify({ leagueId }) },
    );
  },
  getDemoNewsFeed(leagueId: string, phase: DemoPhase = "live") {
    return publicRequest<{ posts: Array<{ id: string; title: string; body: string; createdAt: string }>; demo: boolean; phaseLabel?: string }>(
      "/v1/demo-league/news", { method: "POST", body: JSON.stringify({ leagueId, phase }) },
    );
  },
  getDemoTeamMatchup(leagueId: string, teamId: string, phase: DemoPhase = "live") {
    return publicRequest<{
      weekNumber: number | null;
      matchup: { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string; note?: string } | null;
      draftBoard?: Array<{ round: number; pick: number; team: string; note: string }>;
      demo: boolean;
      phaseLabel?: string;
    }>("/v1/demo-league/matchup", { method: "POST", body: JSON.stringify({ leagueId, teamId, phase }) });
  },
  getDemoTeamRoster(leagueId: string, teamId: string) {
    return publicRequest<{ players: Array<{ id: string; name: string; position: string; overallRating: number | null; devTrait: string | null }> }>(
      "/v1/demo-league/roster", { method: "POST", body: JSON.stringify({ leagueId, teamId }) },
    );
  },
  getAdminEconomyConfig() {
    return request<RecGlobalEconomyConfig>("/v1/admin/economy-config/get", {});
  },
  updateAdminEconomyConfig(config: RecGlobalEconomyConfig) {
    return request<RecGlobalEconomyConfig>("/v1/admin/economy-config/set", config);
  },
  getDemoFantasyDraftPool(leagueId: string) {
    return publicRequest<{ players: Array<{ id: string; name: string; position: string; jerseyNumber: number | null; overallRating: number; photoUrl: string | null; devTrait: string | null; attributes: Record<string, number | null> }> }>(
      "/v1/demo-league/fantasy-draft-pool", { method: "POST", body: JSON.stringify({ leagueId }) },
    );
  },
  getDemoLeagueStats(leagueId: string, teamId?: string | null, position?: string | null) {
    return publicRequest<{
      league: { id: string; name: string; game: string; season_number: number };
      teams: Array<{ id: string; name: string; abbreviation: string | null; conference: string | null; division: string | null }>;
      positions: string[];
      players: Array<{ id: string; fullName: string; position: string | null; jerseyNumber: number | null; photoUrl: string | null; devTrait: string | null; teamId: string | null; teamName: string | null; teamAbbreviation: string | null; stats: Record<string, number> }>;
      leaders: Record<string, Array<{ playerId: string; playerName: string; position: string | null; teamName: string | null; teamAbbreviation: string | null; value: number; rank: number }>>;
    }>("/v1/demo-league/stats", { method: "POST", body: JSON.stringify({ leagueId, teamId: teamId ?? null, position: position ?? null }) });
  },
  getDemoLeagueTeamStats(leagueId: string) {
    return publicRequest<{
      league: { id: string; name: string; game: string; season_number: number };
      teams: Array<{ id: string; name: string; abbreviation: string | null; conference: string | null; division: string | null; stats: Record<string, number> }>;
    }>("/v1/demo-league/team-stats", { method: "POST", body: JSON.stringify({ leagueId }) });
  },
  getDemoStandings(leagueId: string, phase: DemoPhase = "live") {
    return publicRequest<(PublicLeagueSnapshot & { demo: false }) | { demo: true; phaseLabel: string; standings: Array<{ team: string; wins: number; losses: number; ties: number }> }>(
      "/v1/demo-league/standings", { method: "POST", body: JSON.stringify({ leagueId, phase }) },
    );
  },
  getDemoLeagueHistory(leagueId: string) {
    return publicRequest<PublicLeagueHistory>("/v1/demo-league/history", { method: "POST", body: JSON.stringify({ leagueId }) });
  },
  getPublicLeagueSnapshot(guildId: string) {
    return publicRequest<PublicLeagueSnapshot>("/v1/public-league/snapshot", {
      method: "POST",
      body: JSON.stringify({ guildId }),
    });
  },
  getPublicLeagueSnapshotBySlug(slug: string) {
    return publicRequest<PublicLeagueSnapshot>("/v1/public-league/snapshot-by-slug", {
      method: "POST",
      body: JSON.stringify({ slug }),
    });
  },
  getPublicLeagueWeekMatchups(guildId: string, weekNumber?: number) {
    return publicRequest<PublicLeagueWeekMatchups>("/v1/public-league/week-matchups", {
      method: "POST",
      body: JSON.stringify({ guildId, weekNumber }),
    });
  },
  getPublicLeagueWeekMatchupsBySlug(slug: string, weekNumber?: number) {
    return publicRequest<PublicLeagueWeekMatchups>("/v1/public-league/week-matchups-by-slug", {
      method: "POST",
      body: JSON.stringify({ slug, weekNumber }),
    });
  },
  getPublicLeagueHistory(guildId: string) {
    return publicRequest<PublicLeagueHistory>("/v1/public-league/history", {
      method: "POST",
      body: JSON.stringify({ guildId }),
    });
  },
  getPublicLeagueHistoryBySlug(slug: string) {
    return publicRequest<PublicLeagueHistory>("/v1/public-league/history-by-slug", {
      method: "POST",
      body: JSON.stringify({ slug }),
    });
  },
  getMatchupCardRenderData(gameId: string, token: string) {
    return publicRequest<Record<string, unknown>>(`/v1/render/matchup/${gameId}?token=${encodeURIComponent(token)}`);
  },
};

export type DemoPhase = "live" | "week1" | "playoffs" | "championship" | "draft";

export type PublicLeagueSnapshot = {
  league: {
    id: string;
    name: string;
    slug: string;
    game: string | null;
    seasonNumber: number;
    currentWeek: number;
    seasonStage: string;
    statusLabel: string;
  };
  matchups: Array<{ homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string }>;
  linkedTeams: Array<{ teamId: string; teamName: string; coachName: string | null }>;
  standings: Array<{ teamId: string; teamName: string; wins: number; losses: number; ties: number }>;
  openTeams: Array<{ conference: string; teams: Array<{ teamId: string; teamName: string }> }>;
};

export type PublicLeagueWeekMatchups = {
  weekNumber: number;
  currentWeek: number;
  totalWeeks: number;
  matchups: Array<{ homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string }>;
};

export type PublicLeagueHistorySeason = {
  seasonNumber: number;
  teamRecords: Array<{ userId: string; coachName: string; teamId: string | null; teamName: string; abbr: string | null; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>;
  postseasonGames: Array<{ weekNumber: number | null; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; winner: string | null; isBowl: boolean; bowlName: string | null; isNationalChampionship: boolean; isSuperBowl: boolean; postseasonRound: string | null }>;
  bowlWinners: Array<{ bowlName: string | null; winner: string | null; loser: string | null; score: string | null }>;
  championship: { winner: string | null; runnerUp: string | null; score: string | null } | null;
  powerRankings: {
    start: Array<{ rank: number; teamName: string; score: number }>; startWeek: number | null;
    mid: Array<{ rank: number; teamName: string; score: number }>; midWeek: number | null;
    end: Array<{ rank: number; teamName: string; score: number }>; endWeek: number | null;
  };
  finalTop25: Array<{ rank: number; teamName: string; conferenceChampion: boolean }>;
  weeklyResults: Array<{
    weekNumber: number;
    matchups: Array<{ homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; winner: string | null; isTie: boolean; isPlayoff: boolean }>;
    powerRankingShifts: Array<{ teamName: string; previousRank: number | null; newRank: number; delta: number | null }>;
  }>;
};
export type PublicLeagueHistory = {
  league: { name: string; game: string | null };
  currentSeason: number;
  seasons: PublicLeagueHistorySeason[];
};

export type SiteTournamentCountdown = {
  phase: "opens" | "registration" | "kickoff" | "live" | "complete";
  label: string;
  targetAt: string | null;
};

export type SiteTournamentSummary = {
  id: string;
  title: string;
  description: string | null;
  game: string;
  bracketType: string;
  bracketLabel: string;
  bracketSize: number | null;
  payoutScope: "winner" | "final_two" | "final_four";
  winnerCoins: number;
  runnerUpCoins: number;
  semifinalistCoins: number;
  status: string;
  startsAt: string | null;
  createdAt: string;
  lockedAt: string | null;
  completedAt: string | null;
  payoutsIssuedAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  kickoffAt: string | null;
  timezone: string;
  registrationPaused: boolean;
  eventPaused: boolean;
  rules: TournamentRules;
  rulesSummary: string;
  countdown: SiteTournamentCountdown;
  registrationOpen: boolean;
  entrantCount: number;
  approvedCount: number;
  pendingCount: number;
  joined: boolean;
  joinedStatus: "pending" | "approved" | null;
  championDisplayName: string | null;
  rosterLibraryId: string | null;
  teamSelectionMode: "typed" | "claim_pool";
  claimOrderMode: "first_come" | "lottery" | null;
  scheduleMode: "single_kickoff" | "per_round";
  logoUrl: string | null;
  schedulingWindowHours: number;
};

export type SiteTournamentTeamOption = {
  abbr: string;
  name: string;
  conference: string;
};

export type SiteRosterLibrary = {
  id: string;
  game: string;
  name: string;
  isBaseline: boolean;
  sourceNote: string | null;
  playerCount?: number;
  teamCount?: number;
  createdAt: string;
};

export type SiteRosterLibraryPlayer = {
  id: string;
  fullName: string;
  position: string | null;
  jerseyNumber: number | null;
  overallRating: number | null;
  attributes: Record<string, string>;
};

export type SiteRosterLibraryTeam = {
  abbr: string;
  name: string;
  players: SiteRosterLibraryPlayer[];
};

export type SiteLibraryEaPersona = {
  personaId: number;
  displayName: string;
  name: string;
  namespaceName: string;
  console: string;
};

export type SiteLibraryEaConnection = {
  id: string;
  libraryId: string;
  console: string;
  personaDisplayName: string | null;
  eaLeagueId: string | null;
  eaLeagueName: string | null;
  eaSeasonYear: number | null;
  status: string;
  lastError: string | null;
  lastImportAt: string | null;
  createdAt: string;
};

export type SiteLibraryEaFranchise = {
  leagueId: number;
  leagueName: string;
  calendarYear: number;
  numMembers: number;
  userTeamId: number;
  userTeamName: string;
  seasonText: string;
};

export type SiteTournamentLottery = {
  status: "not_scheduled" | "scheduled" | "drawing" | "picking" | "open_pool" | "completed";
  tournamentTitle: string;
  scheduledAt?: string | null;
  drawOrder?: Array<{ userId: string; displayName: string }>;
  currentPosition?: number | null;
  currentUserId?: string | null;
  currentPickDeadlineAt?: string | null;
  openPoolDeadlineAt?: string | null;
  skipped?: Array<{ userId: string; resolved: boolean }>;
};

export type SiteTournamentPlayer = {
  userId: string;
  displayName: string;
  teamAbbr?: string | null;
  teamName?: string | null;
  isHome?: boolean;
};

export type SiteTournamentMatchReview = {
  matchId: string;
  tournamentId: string;
  tournamentTitle: string;
  playerA: { userId: string | null; displayName: string; teamName: string | null };
  playerB: { userId: string | null; displayName: string; teamName: string | null };
  winnerUserId: string | null;
  resultMethod: "final_screenshot" | "concede" | "opponent_quit" | null;
  screenshotUrl: string | null;
  concededByUserId: string | null;
  playerAScore: number | null;
  playerBScore: number | null;
  submittedAt: string;
};

export type SiteTournamentDetail = {
  tournament: SiteTournamentSummary;
  claimedTeams?: string[];
  entrants: Array<{
    userId: string;
    seed: number | null;
    displayName: string;
    gamerTag: string | null;
    teamAbbr: string | null;
    teamName: string | null;
    entryStatus: "pending" | "approved" | "removed";
    isYou: boolean;
  }>;
  matches: Array<{
    id: string;
    key: string;
    side: "winners" | "losers" | "grand_final";
    round: number;
    slot: number;
    scheduledAt: string | null;
    status: string;
    homeMustStream: boolean;
    resultMethod: string | null;
    screenshotUrl: string | null;
    streamUrl: string | null;
    playerAScore: number | null;
    playerBScore: number | null;
    bettingOpen: boolean;
    boxScore: SiteTournamentBoxScore | null;
    playerA: SiteTournamentPlayer | null;
    playerB: SiteTournamentPlayer | null;
    winnerUserId: string | null;
    winnerDisplayName: string | null;
    scheduling: SiteTournamentMatchScheduling | null;
  }>;
};

export type SiteTournamentMatchScheduling = {
  status: "not_scheduled" | "proposed" | "confirmed" | "reschedule_requested";
  scheduledFor: string | null;
  pendingProposal: { id: string; proposedByUserId: string; proposedFor: string } | null;
};

export type SiteTournamentHomeCard = {
  tournament: SiteTournamentSummary;
  you: { userId: string; displayName: string; teamAbbr: string | null; teamName: string | null; record: string } | null;
  opponent: { userId: string; displayName: string; teamAbbr: string | null; teamName: string | null; record: string } | null;
  match: { id: string; status: string; homeMustStream: boolean } | null;
};

export type SiteTournamentBoxScore = {
  home?: {
    totalYards?: number | null;
    rushYards?: number | null;
    passYards?: number | null;
    turnovers?: number | null;
    redzoneOff?: number | null;
    redzoneDef?: number | null;
  } | null;
  away?: {
    totalYards?: number | null;
    rushYards?: number | null;
    passYards?: number | null;
    turnovers?: number | null;
    redzoneOff?: number | null;
    redzoneDef?: number | null;
  } | null;
};

export type SiteTournamentHighlight = {
  id: string;
  matchId: string;
  userId: string;
  url: string | null;
  playbackUrl: string | null;
  iframeUrl: string | null;
  streamUid: string | null;
  status: "pending" | "approved" | "rejected";
  mediaStatus: "pending" | "uploading" | "processing" | "ready" | "failed";
  createdAt: string;
  displayName: string;
  teamName: string | null;
  tournamentTitle: string;
  matchupLabel: string;
  label: string;
  isYou: boolean;
};

export type SiteTournamentWager = {
  id: string;
  matchId: string;
  wagerKind: "house" | "peer";
  market: "house" | "peer" | "h2h";
  marketKey: string;
  pick: string;
  pickUserId: string | null;
  line: number | null;
  odds: number | null;
  stake: number;
  potentialPayout: number;
  isParlay: boolean;
  status: string;
  userId: string;
  userDisplayName: string;
  pickDisplayName: string;
  acceptedByUserId: string | null;
  acceptedDisplayName: string | null;
  payoutAmount: number;
};

export type SiteTournamentWagerOptions = {
  matchId: string;
  homeUserId: string;
  awayUserId: string;
  homeLabel: string;
  awayLabel: string;
  bettingOpen: boolean;
  markets: Array<{
    market: string;
    label: string;
    kind: string;
    line: number | null;
    unit?: string;
    sides: Array<{ pick: string; label: string; odds: number }>;
  }>;
};

export type CompUserSummary = {
  id: string;
  username: string | null;
  displayName: string;
};

export type CompUserDetail = {
  displayName: string;
  username: string | null;
  memberSince: string | null;
  globalRecord: {
    wins: number;
    losses: number;
    ties: number;
    playoffWins: number;
    playoffLosses: number;
    superbowlWins: number;
    superbowlLosses: number;
    gamesPlayed: number;
    pointDifferential: number;
  };
  careerStats: Array<{
    [key: string]: string | number;
    game: string;
    gameLabel: string;
    gamesLogged: number;
    passingYards: number;
    rushingYards: number;
    totalYards: number;
    firstDowns: number;
    turnoversGenerated: number;
    turnoversCommitted: number;
    turnoverDifferential: number;
  }>;
};

export type PowerRankPosition = { rank: number; of: number; previousRank: number | null };

export type PowerRankingRow = {
  rank: number;
  previousRank: number | null;
  userId: string;
  username: string | null;
  displayName: string;
  score: number;
};

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  published: boolean;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PromoCodeEffectType = "lifetime_platinum" | "lifetime_gold" | "bonus_coins" | "trial_gold" | "trial_platinum";

export type PromoCode = {
  id: string;
  code: string;
  description: string | null;
  effectType: PromoCodeEffectType;
  effectValue: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLeagueSummary = {
  id: string;
  name: string;
  game: string;
  leagueType: string;
  currentPhase: string;
  seasonStage: string;
  seasonNumber: number;
  ownerUserId: string | null;
  ownerUsername: string | null;
  memberCount: number;
  teamCount: number;
  createdAt: string;
};

export type AdminLeagueMember = {
  userId: string;
  username: string | null;
  displayName: string;
  discordUsername: string | null;
  teamName: string | null;
  membershipRole: string | null;
};

export type AdminUserSummary = {
  id: string;
  username: string | null;
  displayName: string;
  discordUsername: string | null;
  subscriptionTier: string;
  billingStatus: string | null;
  hasSiteAccount: boolean;
  walletBalance: number | null;
  savingsBalance: number | null;
};

export type AdminDiscordConfig = {
  managementGuildId: string | null;
  leaguePostChannels: { madden_26: string | null; madden_27: string | null; cfb_27: string | null };
};
export type AdminStats = {
  totalUsers: number;
  siteLinkedUsers: number;
  linkedPlatinum: number;
  linkedGold: number;
  unlinkedPlatinum: number;
  unlinkedGold: number;
  orphanedPaid: number;
  goldSubscribers: number;
  platinumSubscribers: number;
  usersLast7d: number;
  totalLeagues: number;
  leaguesLast7d: number;
  openIncidents: Array<{
    id: string;
    leagueId: string | null;
    guildId: string | null;
    process: string;
    severity: string;
    title: string;
    detail: string | null;
    errorName: string | null;
    errorMessage: string | null;
    errorStack: string | null;
    context: Record<string, unknown>;
    occurredAt: string;
  }>;
};

export type AdminIncident = {
  id: string;
  league_id: string | null;
  guild_id: string | null;
  process: string;
  severity: string;
  status: string;
  title: string;
  detail: string | null;
  error_name: string | null;
  error_message: string | null;
  error_stack: string | null;
  context: Record<string, unknown>;
  occurred_at: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  fingerprint: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  workorder_status: string;
  workorder_conversation_id: string | null;
  workorder_started_at: string | null;
  workorder_note: string | null;
};

export type IncidentPatternSummary = {
  total: number;
  open: number;
  resolved: number;
  ignored: number;
  last24h: number;
  last7d: number;
  byProcess: Array<{ process: string; count: number; openCount: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  topPatterns: Array<{
    fingerprint: string;
    process: string;
    title: string;
    errorMessage: string | null;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    status: string;
    leagueId: string | null;
  }>;
  dailyVolume: Array<{ date: string; count: number }>;
};

export type SiteHomeCard = {
  displayName: string;
  username: string | null;
  memberSince: string | null;
  globalRecord: { wins: number; losses: number; ties: number; text: string };
  performanceRecord: {
    playoffWins: number;
    playoffLosses: number;
    superbowlWins: number;
    superbowlLosses: number;
    pointDifferential: number;
    avgPointDifferential: number;
    gamesPlayed: number;
    currentStreak: string;
  };
  userRating: { rating: number; grade: string; displayAsGrade: boolean } | null;
  currentGame: string | null;
  dynastyPowerRank: PowerRankPosition | null;
  compPowerRank: PowerRankPosition | null;
  careerAwardsWon: number;
  leaguesActivity: { activeLeagues: number; commissionerOf: number };
};

export type SiteAnnouncement = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

export type SpotlightComment = {
  id: string;
  body: string;
  createdAt: string;
  author: { displayName: string; username: string | null };
};

export type SpotlightItem = {
  id: string;
  rank: number;
  selectedAt: string;
  selectionScore: number;
  league: { id: string; name: string; game: string | null };
  seasonNumber: number | null;
  weekNumber: number | null;
  seasonStage: string | null;
  author: { userId: string; displayName: string; username: string | null };
  team: { name: string; abbreviation: string | null } | null;
  matchupLabel: string | null;
  matchupParticipants: { away: string; home: string } | null;
  videoUrl: string | null;
  streamUid: string | null;
  iframeUrl: string | null;
  messageUrl: string | null;
  reactionCounts: { like: number; dislike: number };
  myReaction: "like" | "dislike" | null;
  comments: SpotlightComment[];
};

export type SpotlightReelResponse = {
  items: SpotlightItem[];
  selectedAt: string | null;
};
