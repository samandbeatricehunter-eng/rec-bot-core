import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { publicApiBaseUrl, twitchConfigured, twitchEventsubSecret } from "./streaming-config.js";
import type { StreamingTokenPair } from "./streaming-token-vault.js";

const TWITCH_ID = "https://id.twitch.tv/oauth2";
const TWITCH_HELIX = "https://api.twitch.tv/helix";

type TwitchTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
};

type TwitchUser = { id: string; login: string; display_name: string };

async function twitchForm(path: string, body: Record<string, string>): Promise<TwitchTokenResponse> {
  const res = await fetch(`${TWITCH_ID}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(502, `Twitch sign-in failed (${res.status}). ${text.slice(0, 180)}`.trim());
  }
  return (await res.json()) as TwitchTokenResponse;
}

export function twitchOAuthRedirectUri(): string {
  const base = publicApiBaseUrl();
  if (!base) throw new ApiError(503, "Twitch linking is not configured.");
  return `${base}/v1/streaming/oauth/twitch/callback`;
}

export function twitchAuthorizeUrl(state: string): string {
  if (!twitchConfigured()) throw new ApiError(503, "Twitch linking is not configured.");
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID!,
    redirect_uri: twitchOAuthRedirectUri(),
    response_type: "code",
    scope: "",
    state,
  });
  return `${TWITCH_ID}/authorize?${params.toString()}`;
}

export async function exchangeTwitchCode(code: string): Promise<StreamingTokenPair> {
  const token = await twitchForm("/token", {
    client_id: env.TWITCH_CLIENT_ID!,
    client_secret: env.TWITCH_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: twitchOAuthRedirectUri(),
  });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

export async function twitchAppAccessToken(): Promise<string> {
  const token = await twitchForm("/token", {
    client_id: env.TWITCH_CLIENT_ID!,
    client_secret: env.TWITCH_CLIENT_SECRET!,
    grant_type: "client_credentials",
  });
  return token.access_token;
}

export async function fetchTwitchUser(accessToken: string): Promise<TwitchUser> {
  const res = await fetch(`${TWITCH_HELIX}/users`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": env.TWITCH_CLIENT_ID!,
    },
  });
  if (!res.ok) throw new ApiError(502, `Twitch could not load your channel (${res.status}).`);
  const payload = (await res.json()) as { data?: TwitchUser[] };
  const user = payload.data?.[0];
  if (!user) throw new ApiError(502, "Twitch did not return a channel for that account.");
  return user;
}

export async function helixGetStreams(userIds: string[]): Promise<Array<{ user_id: string; id: string; user_login: string }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !twitchConfigured()) return [];
  const token = await twitchAppAccessToken();
  const out: Array<{ user_id: string; id: string; user_login: string }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const params = new URLSearchParams();
    for (const id of batch) params.append("user_id", id);
    const res = await fetch(`${TWITCH_HELIX}/streams?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": env.TWITCH_CLIENT_ID! },
    });
    if (!res.ok) continue;
    const payload = (await res.json()) as { data?: Array<{ user_id: string; id: string; user_login: string }> };
    out.push(...(payload.data ?? []));
  }
  return out;
}

export async function subscribeTwitchStreamEvents(twitchUserId: string): Promise<{ onlineId: string | null; offlineId: string | null }> {
  const base = publicApiBaseUrl();
  if (!base || !twitchConfigured()) return { onlineId: null, offlineId: null };
  const token = await twitchAppAccessToken();
  const callback = `${base}/v1/streaming/twitch/eventsub`;
  const secret = twitchEventsubSecret();

  async function subscribe(type: "stream.online" | "stream.offline"): Promise<string | null> {
    const res = await fetch(`${TWITCH_HELIX}/eventsub/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": env.TWITCH_CLIENT_ID!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type,
        version: "1",
        condition: { broadcaster_user_id: twitchUserId },
        transport: { method: "webhook", callback, secret },
      }),
    });
    if (res.status === 409) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[WARN] Twitch EventSub subscribe failed", type, res.status, text.slice(0, 300));
      return null;
    }
    const payload = (await res.json()) as { data?: Array<{ id: string }> };
    return payload.data?.[0]?.id ?? null;
  }

  const [onlineId, offlineId] = await Promise.all([subscribe("stream.online"), subscribe("stream.offline")]);
  return { onlineId, offlineId };
}

export async function deleteTwitchEventsub(subscriptionId: string | null | undefined): Promise<void> {
  if (!subscriptionId || !twitchConfigured()) return;
  const token = await twitchAppAccessToken();
  await fetch(`${TWITCH_HELIX}/eventsub/subscriptions?id=${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Client-Id": env.TWITCH_CLIENT_ID! },
  }).catch(() => undefined);
}

export function verifyTwitchEventsubSignature(rawBody: string, headers: {
  messageId?: string;
  timestamp?: string;
  signature?: string;
}): boolean {
  const messageId = headers.messageId ?? "";
  const timestamp = headers.timestamp ?? "";
  const signature = headers.signature ?? "";
  if (!messageId || !timestamp || !signature.startsWith("sha256=")) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 600) return false;
  const expected = `sha256=${createHmac("sha256", twitchEventsubSecret()).update(messageId + timestamp + rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
