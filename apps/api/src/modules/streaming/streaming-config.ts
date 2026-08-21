import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { StreamPlatform } from "./streaming-labels.js";

export function publicApiBaseUrl(): string | null {
  const configured = env.STREAMING_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return null;
}

export function twitchEventsubSecret(): string {
  const configured = env.TWITCH_EVENTSUB_SECRET?.trim();
  if (configured && configured.length >= 10 && configured.length <= 100) return configured;
  return createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY).update("twitch-eventsub").digest("hex").slice(0, 32);
}

function oauthSigningKey(): string {
  return env.ACTIVITY_JWT_SECRET?.trim() || env.SUPABASE_SERVICE_ROLE_KEY;
}

export function signOAuthState(input: { authUserId: string; platform: StreamPlatform }): string {
  const payload = Buffer.from(
    JSON.stringify({
      authUserId: input.authUserId,
      platform: input.platform,
      exp: Date.now() + 10 * 60_000,
      n: Math.random().toString(36).slice(2),
    }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", oauthSigningKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): { authUserId: string; platform: StreamPlatform } {
  const [payload, sig] = String(state ?? "").split(".");
  if (!payload || !sig) throw new ApiError(400, "That sign-in link expired. Start again from Account.");
  const expected = createHmac("sha256", oauthSigningKey()).update(payload).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(400, "That sign-in link is invalid. Start again from Account.");
  }
  let parsed: { authUserId?: string; platform?: string; exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "That sign-in link is invalid. Start again from Account.");
  }
  if (!parsed.exp || parsed.exp < Date.now()) {
    throw new ApiError(400, "That sign-in link expired. Start again from Account.");
  }
  if (parsed.platform !== "twitch" && parsed.platform !== "youtube" && parsed.platform !== "tiktok") {
    throw new ApiError(400, "That sign-in link is invalid. Start again from Account.");
  }
  if (!parsed.authUserId) throw new ApiError(400, "That sign-in link is invalid. Start again from Account.");
  return { authUserId: parsed.authUserId, platform: parsed.platform };
}

export function siteAccountRedirect(query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  return `${env.SITE_PUBLIC_URL.replace(/\/$/, "")}/account?tab=linked&${params.toString()}`;
}

export function twitchConfigured(): boolean {
  return Boolean(env.TWITCH_CLIENT_ID?.trim() && env.TWITCH_CLIENT_SECRET?.trim() && publicApiBaseUrl());
}

export function youtubeConfigured(): boolean {
  return Boolean(env.YOUTUBE_CLIENT_ID?.trim() && env.YOUTUBE_CLIENT_SECRET?.trim() && publicApiBaseUrl());
}

export function tiktokOAuthConfigured(): boolean {
  return Boolean(env.TIKTOK_CLIENT_KEY?.trim() && env.TIKTOK_CLIENT_SECRET?.trim() && publicApiBaseUrl());
}
