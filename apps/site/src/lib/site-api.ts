import { supabase } from "./supabase-client.js";

const apiBaseUrl = import.meta.env.VITE_REC_CORE_API_URL;

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
  if (!apiBaseUrl) {
    throw new Error("Missing VITE_REC_CORE_API_URL in apps/site/.env.");
  }
  return apiBaseUrl;
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
};

export type SiteNotificationItem = {
  id: string;
  title: string;
  body: string | null;
  href: string;
  read: boolean;
  createdAt: string;
  kind: "regular" | "commissioner";
  isInboxLink?: boolean;
  leagueId?: string | null;
  leagueName?: string | null;
};

export const siteApi = {
  getLinkProfile() {
    return request<LinkProfileResponse>("/v1/site-auth/me", {});
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
  createCheckout(tier: "gold" | "platinum") {
    const origin = window.location.origin;
    return request<{ url: string }>("/v1/subscriptions/checkout", {
      tier,
      successUrl: `${origin}/pricing?checkout=success`,
      cancelUrl: `${origin}/pricing?checkout=cancel`,
    });
  },
  openBillingPortal() {
    const origin = window.location.origin;
    return request<{ url: string }>("/v1/subscriptions/portal", {
      returnUrl: `${origin}/account`,
    });
  },
  getRegistrationGate() {
    return publicRequest<RegistrationGate>("/v1/subscriptions/registration-gate");
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
  retireFromLeague(leagueId: string) {
    return request<{ ok: true }>("/v1/site-leagues/retire", { leagueId });
  },
  listNotifications() {
    return request<{
      regular: SiteNotificationItem[];
      commissioner: SiteNotificationItem[];
      unreadCount: number;
    }>("/v1/site-notifications/list", {});
  },
  markNotificationsRead(ids: string[]) {
    return request<{ ok: true; updated: number }>(
      "/v1/site-notifications/mark-read",
      { ids },
    );
  },
};