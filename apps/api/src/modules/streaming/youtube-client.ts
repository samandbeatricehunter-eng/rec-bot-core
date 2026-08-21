import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { publicApiBaseUrl, youtubeConfigured } from "./streaming-config.js";
import { isStreamingTokenExpired, type StreamingTokenPair } from "./streaming-token-vault.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export function youtubeOAuthRedirectUri(): string {
  const base = publicApiBaseUrl();
  if (!base) throw new ApiError(503, "YouTube linking is not configured.");
  return `${base}/v1/streaming/oauth/youtube/callback`;
}

export function youtubeAuthorizeUrl(state: string): string {
  if (!youtubeConfigured()) throw new ApiError(503, "YouTube linking is not configured.");
  const params = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID!,
    redirect_uri: youtubeOAuthRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: YOUTUBE_SCOPE,
    state,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

async function exchangeGoogleToken(body: Record<string, string>): Promise<StreamingTokenPair> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(502, `YouTube sign-in failed (${res.status}). ${text.slice(0, 180)}`.trim());
  }
  const token = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

export async function exchangeYoutubeCode(code: string): Promise<StreamingTokenPair> {
  return exchangeGoogleToken({
    client_id: env.YOUTUBE_CLIENT_ID!,
    client_secret: env.YOUTUBE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: youtubeOAuthRedirectUri(),
  });
}

export async function refreshYoutubeToken(refreshToken: string): Promise<StreamingTokenPair> {
  const next = await exchangeGoogleToken({
    client_id: env.YOUTUBE_CLIENT_ID!,
    client_secret: env.YOUTUBE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return { ...next, refreshToken: next.refreshToken ?? refreshToken };
}

export async function fetchYoutubeChannel(accessToken: string): Promise<{ id: string; title: string; customUrl: string | null }> {
  const res = await fetch(`${YOUTUBE_API}/channels?part=id,snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(502, `YouTube could not load your channel (${res.status}).`);
  const payload = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }>;
  };
  const channel = payload.items?.[0];
  if (!channel?.id) throw new ApiError(502, "YouTube did not return a channel for that account.");
  return {
    id: channel.id,
    title: channel.snippet?.title ?? "YouTube",
    customUrl: channel.snippet?.customUrl ?? null,
  };
}

export async function youtubeIsLive(token: StreamingTokenPair): Promise<{ live: boolean; streamId: string | null }> {
  let access = token.accessToken;
  if (token.refreshToken && isStreamingTokenExpired(token)) {
    const refreshed = await refreshYoutubeToken(token.refreshToken);
    access = refreshed.accessToken;
    Object.assign(token, refreshed);
  }
  const res = await fetch(`${YOUTUBE_API}/liveBroadcasts?part=id,status&mine=true&broadcastStatus=active`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) return { live: false, streamId: null };
  const payload = (await res.json()) as { items?: Array<{ id: string }> };
  const item = payload.items?.[0];
  return { live: Boolean(item?.id), streamId: item?.id ?? null };
}

/** Best-effort live check for a saved handle when the user linked a username instead of OAuth. */
export async function youtubeHandleIsLive(handle: string): Promise<{ live: boolean; streamId: string | null }> {
  const slug = handle.replace(/^@/, "").trim();
  if (!slug) return { live: false, streamId: null };
  const url = slug.startsWith("UC") && slug.length >= 22
    ? `https://www.youtube.com/channel/${encodeURIComponent(slug)}/live`
    : `https://www.youtube.com/@${encodeURIComponent(slug)}/live`;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; RECBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { live: false, streamId: null };
    const finalUrl = res.url ?? "";
    const watch = finalUrl.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
    if (watch?.[1]) return { live: true, streamId: watch[1] };
    const html = await res.text();
    const live = /"isLiveNow"\s*:\s*true/.test(html) || /"isLive"\s*:\s*true/.test(html);
    return { live, streamId: null };
  } catch {
    return { live: false, streamId: null };
  }
}
