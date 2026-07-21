import { supabase } from "./supabase-client.js";

const apiBaseUrl = import.meta.env.VITE_REC_CORE_API_URL;

type LinkProfileResponse = {
  linked: boolean;
  recUserId: string | null;
  displayName: string | null;
  username: string | null;
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

async function request<T>(path: string, body: unknown): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("Missing VITE_REC_CORE_API_URL in apps/site/.env.");
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You are not signed in.");
  const response = await fetch(`${apiBaseUrl}${path}`, {
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
  section: "regular" | "commissioner";
  kind: string;
  title: string;
  body: string | null;
  href: string;
  leagueId: string | null;
  leagueName: string | null;
  createdAt: string;
  read: boolean;
  isInboxLink?: boolean;
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
