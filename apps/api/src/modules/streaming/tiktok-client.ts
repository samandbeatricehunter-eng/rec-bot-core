import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { publicApiBaseUrl, tiktokOAuthConfigured } from "./streaming-config.js";
import { normalizeStreamHandle } from "./streaming-labels.js";
import type { StreamingTokenPair } from "./streaming-token-vault.js";

const TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER = "https://open.tiktokapis.com/v2/user/info/";

export function normalizeTiktokUsername(raw: string): string {
  return normalizeStreamHandle("tiktok", raw);
}

export function tiktokOAuthRedirectUri(): string {
  const base = publicApiBaseUrl();
  if (!base) throw new ApiError(503, "TikTok linking is not configured.");
  return `${base}/v1/streaming/oauth/tiktok/callback`;
}

export function tiktokAuthorizeUrl(state: string): string {
  if (!tiktokOAuthConfigured()) throw new ApiError(503, "TikTok linking is not configured.");
  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY!,
    redirect_uri: tiktokOAuthRedirectUri(),
    response_type: "code",
    scope: "user.info.basic",
    state,
  });
  return `${TIKTOK_AUTH}?${params.toString()}`;
}

export async function exchangeTiktokCode(code: string): Promise<StreamingTokenPair & { openId: string; displayName: string; username: string }> {
  const res = await fetch(TIKTOK_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      client_secret: env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: tiktokOAuthRedirectUri(),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(502, `TikTok sign-in failed (${res.status}). ${text.slice(0, 180)}`.trim());
  }
  const token = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
  };
  if (!token.access_token || !token.open_id) throw new ApiError(502, "TikTok did not return an account for that sign-in.");

  const userRes = await fetch(`${TIKTOK_USER}?fields=open_id,display_name,username`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const userPayload = userRes.ok
    ? ((await userRes.json()) as { data?: { user?: { display_name?: string; username?: string } } })
    : null;
  const username = normalizeTiktokUsername(userPayload?.data?.user?.username ?? token.open_id);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    openId: token.open_id,
    displayName: userPayload?.data?.user?.display_name ?? username,
    username,
  };
}

/** Best-effort live check. TikTok has no public EventSub equivalent. */
export async function tiktokIsLive(username: string): Promise<boolean> {
  const handle = normalizeTiktokUsername(username);
  if (!handle) return false;
  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}/live`, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; RECBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const html = await res.text();
    return /"isLive"\s*:\s*true/i.test(html) || /"status"\s*:\s*2/.test(html) || /live-room/i.test(html);
  } catch {
    return false;
  }
}
