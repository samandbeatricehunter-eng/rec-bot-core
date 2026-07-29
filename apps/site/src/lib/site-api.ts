import { siteApiBaseUrl, supabase } from "./supabase-client.js";

const apiBaseUrl = () => siteApiBaseUrl() || (import.meta.env.VITE_REC_CORE_API_URL as string | undefined);

export type SubscriptionTier = "none" | "gold" | "platinum";
export type BillingStatus =
  | "none"
  | "active"
  | "lifetime_comp"
  | "past_due"
  | "canceled"
  | "grace";

export type EntitlementSummary = {
  tier: SubscriptionTier;
  billingStatus: BillingStatus;
  graceUntil: string | null;
  currentPeriodEnd: string | null;
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
    throw new Error(payload?.error ?? payload?.message ?? "Request failed.");
  }
  return payload as T;
}

async function request<T>(path: string, body: unknown = {}): Promise<T> {
  const base = requireApiBaseUrl();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You are not signed in.");
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
  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.message ?? "Request failed.");
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

export type DmTarget = {
  userId: string;
  username: string;
  displayName: string;
};

export type SiteLeagueSummary = {
  id: string;
  name: string;
  game: string;
  gameLabel: string;
  teamName: string | null;
  isCommissioner: boolean;
  commissionerRole?: "head" | "co" | "member";
  discordBotEnabled: boolean;
};

export type SiteLeagueTickerItem = {
  gameId: string;
  awayTeamName: string;
  homeTeamName: string;
  awayScore: number | null;
  homeScore: number | null;
  isFinal: boolean;
  isLive: boolean;
  odds: { awayMoneyline: number; homeMoneyline: number; overUnder: number | null } | null;
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
  game: string;
  gameLabel: string;
  seasonStage: string;
  seasonStageLabel: string;
  seasonNumber: number;
  currentWeek: number | null;
  openTeamCount: number;
  memberCount: number;
  commissionerUsername: string | null;
  commissionerDiscordName: string | null;
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
  linkDiscordOAuth() {
    return request<
      LinkProfileResponse & { lifetimePlatinum: boolean; discordLinked: boolean }
    >("/v1/site-auth/link/discord-oauth", {});
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
  getBotInviteUrl() {
    return publicRequest<{ inviteUrl: string }>("/v1/subscriptions/bot/invite-url", {
      method: "POST",
      body: JSON.stringify({}),
    });
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
  listMyBadges() {
    return request<{
      badges: Array<{
        badge_key: string;
        badge_label?: string;
        badge_scope: string;
        polarity: string | null;
        tier: string | null;
        earned_count: number | null;
        description?: string;
        earnedByGame?: Record<string, number>;
        league_id?: string | null;
        season?: number | null;
        week?: number | null;
        updated_at?: string | null;
      }>;
      count: number;
    }>("/v1/site-home/badges", {});
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
  getAdminStats() {
    return request<AdminStats>("/v1/admin/stats", {});
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
  impersonateUser(userId: string) {
    return request<{ accessToken: string; refreshToken: string; targetUsername: string | null }>(
      "/v1/admin/impersonate",
      { userId },
    );
  },
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
  teamName: string | null;
  membershipRole: string | null;
};

export type AdminUserSummary = {
  id: string;
  username: string | null;
  displayName: string;
  subscriptionTier: string;
  hasSiteAccount: boolean;
};

export type AdminStats = {
  totalUsers: number;
  siteLinkedUsers: number;
  linkedPlatinum: number;
  linkedGold: number;
  unlinkedPlatinum: number;
  unlinkedGold: number;
  goldSubscribers: number;
  platinumSubscribers: number;
  usersLast7d: number;
  totalLeagues: number;
  leaguesLast7d: number;
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
  powerRank: { rank: number; of: number } | null;
  badgeCount: number;
  recentBadge: { key: string; label: string; scope: string; tier: string | null; earnedAt: string } | null;
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
