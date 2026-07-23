import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";

const STREAM_API = "https://api.cloudflare.com/client/v4";
/** Highlights are short clips; reject uploads longer than 45 seconds. */
export const HIGHLIGHT_MAX_DURATION_SECONDS = 45;
export const HIGHLIGHT_MAX_HEIGHT = 720;

function requireStreamConfig() {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new ApiError(503, "Cloudflare Stream is not configured on this API.");
  }
  return { accountId, apiToken };
}

function streamHeaders(apiToken: string) {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
}

export function streamAllowedOrigins(): string[] {
  const fromEnv = (env.CLOUDFLARE_STREAM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
  ];
  // Stream expects hostnames (example.com), not full URLs — full URLs cause 400 Bad Request.
  return [...new Set([...defaults, ...fromEnv])]
    .map((origin) => {
      try {
        if (origin.includes("://")) return new URL(origin).host;
      } catch {
        /* fall through */
      }
      return origin.replace(/^https?:\/\//i, "").split("/")[0] ?? origin;
    })
    .filter(Boolean);
}

export function streamPlaybackUrls(uid: string): { hls: string; iframe: string; watch: string } {
  const host = (env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN ?? "iframe.videodelivery.net").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (host.startsWith("customer-") && host.includes("cloudflarestream.com")) {
    return {
      hls: `https://${host}/${uid}/manifest/video.m3u8`,
      iframe: `https://${host}/${uid}/iframe`,
      watch: `https://${host}/${uid}/watch`,
    };
  }
  return {
    hls: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
    iframe: `https://iframe.videodelivery.net/${uid}`,
    watch: `https://watch.cloudflarestream.com/${uid}`,
  };
}

type DirectUploadResult = { uid: string; uploadURL: string };

export async function createStreamDirectUpload(input: {
  maxDurationSeconds?: number;
  meta?: Record<string, string>;
}): Promise<DirectUploadResult> {
  const { accountId, apiToken } = requireStreamConfig();
  const response = await fetch(`${STREAM_API}/accounts/${accountId}/stream/direct_upload`, {
    method: "POST",
    headers: streamHeaders(apiToken),
    body: JSON.stringify({
      maxDurationSeconds: input.maxDurationSeconds ?? HIGHLIGHT_MAX_DURATION_SECONDS,
      requireSignedURLs: false,
      allowedOrigins: streamAllowedOrigins(),
      meta: input.meta ?? {},
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    result?: { uid?: string; uploadURL?: string };
    errors?: Array<{ message?: string }>;
  } | null;
  if (!response.ok || !payload?.success || !payload.result?.uid || !payload.result?.uploadURL) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new ApiError(502, `Failed to create Stream upload URL (${detail}).`);
  }
  return { uid: payload.result.uid, uploadURL: payload.result.uploadURL };
}

/** Pull an existing public media URL into Cloudflare Stream (migration / backfill). */
export async function copyStreamFromUrl(input: {
  url: string;
  meta?: Record<string, string>;
}): Promise<{ uid: string }> {
  const { accountId, apiToken } = requireStreamConfig();
  const response = await fetch(`${STREAM_API}/accounts/${accountId}/stream/copy`, {
    method: "POST",
    headers: streamHeaders(apiToken),
    body: JSON.stringify({
      url: input.url,
      meta: input.meta ?? {},
      requireSignedURLs: false,
      allowedOrigins: streamAllowedOrigins(),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    result?: { uid?: string };
    errors?: Array<{ message?: string }>;
    messages?: Array<{ message?: string }>;
  } | null;
  if (!response.ok || !payload?.success || !payload.result?.uid) {
    const detail =
      payload?.errors?.[0]?.message
      ?? payload?.messages?.[0]?.message
      ?? `HTTP ${response.status}`;
    throw new ApiError(502, `Failed to copy media into Stream (${detail}).`);
  }
  return { uid: payload.result.uid };
}

export async function deleteStreamVideo(uid: string): Promise<void> {
  if (!uid.trim()) return;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    console.warn(`[WARN] deleteStreamVideo skipped (Stream not configured): ${uid}`);
    return;
  }
  const response = await fetch(`${STREAM_API}/accounts/${accountId}/stream/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    headers: streamHeaders(apiToken),
    signal: AbortSignal.timeout(20_000),
  });
  // 404 = already gone — treat as success for cleanup idempotency.
  if (response.ok || response.status === 404) return;
  const payload = await response.json().catch(() => null) as { errors?: Array<{ message?: string }> } | null;
  const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
  throw new Error(`Stream delete failed for ${uid}: ${detail}`);
}

export function verifyStreamWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = env.CLOUDFLARE_STREAM_WEBHOOK_SECRET?.trim();
  if (!secret) throw new ApiError(503, "Cloudflare Stream webhook secret is not configured.");
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  ) as { time?: string; sig1?: string };

  const time = parts.time;
  const sig1 = parts.sig1;
  if (!time || !sig1) return false;

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(time));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = createHmac("sha256", secret).update(`${time}.${rawBody}`).digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig1, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
