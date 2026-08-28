import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { bestEffort } from "./best-effort.js";
import { ApiError } from "./errors.js";

const STREAM_API = "https://api.cloudflare.com/client/v4";
/** Highlights are short clips; reject uploads longer than 45 seconds. */
export const HIGHLIGHT_MAX_DURATION_SECONDS = 45;
export const HIGHLIGHT_MAX_HEIGHT = 1080;

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
  // Cloudflare's own hosted watch page (watch.cloudflarestream.com, or this account's
  // customer-*.cloudflarestream.com) sets its own domain as parentOrigin when it requests the
  // playback manifest -- without it in the allow list, opening a bare "watch" link directly
  // (as opposed to embedding the video via <iframe> on one of the origins above) 403s on the
  // manifest request even though the video itself has requireSignedURLs:false. Every Stream
  // video needs to support being opened as a plain shareable link, not just embedded on-site.
  const streamHost = (env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (streamHost) defaults.push(streamHost);
  defaults.push("watch.cloudflarestream.com", "iframe.videodelivery.net");
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
  const payload = await bestEffort("cloudflare.stream.parse_direct_upload", () => response.json(), {}) as {
    success?: boolean;
    result?: { uid?: string; uploadURL?: string };
    errors?: Array<{ message?: string }>;
  } | null | undefined;
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
  const payload = await bestEffort("cloudflare.stream.parse_copy", () => response.json(), {}) as {
    success?: boolean;
    result?: { uid?: string };
    errors?: Array<{ message?: string }>;
    messages?: Array<{ message?: string }>;
  } | null | undefined;
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
  const payload = await bestEffort("cloudflare.stream.parse_delete_error", () => response.json(), { entityId: uid }) as { errors?: Array<{ message?: string }> } | null | undefined;
  const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
  throw new Error(`Stream delete failed for ${uid}: ${detail}`);
}

export async function inspectStreamVideo(uid: string): Promise<{
  exists: boolean;
  ready: boolean;
  height: number | null;
}> {
  if (!uid.trim()) return { exists: false, ready: false, height: null };
  const { accountId, apiToken } = requireStreamConfig();
  const response = await fetch(
    `${STREAM_API}/accounts/${accountId}/stream/${encodeURIComponent(uid)}`,
    { headers: streamHeaders(apiToken), signal: AbortSignal.timeout(20_000) },
  );
  if (response.status === 404) return { exists: false, ready: false, height: null };
  const payload = await bestEffort("cloudflare.stream.parse_inspect", () => response.json(), { entityId: uid }) as {
    success?: boolean;
    result?: {
      readyToStream?: boolean;
      status?: { state?: string };
      input?: { height?: number };
    };
  } | null | undefined;
  if (!response.ok || !payload?.success || !payload.result) {
    throw new Error(`Stream inspect failed for ${uid} (HTTP ${response.status}).`);
  }
  return {
    exists: true,
    ready:
      payload.result.readyToStream === true ||
      payload.result.status?.state === "ready",
    height:
      Number.isFinite(Number(payload.result.input?.height))
        ? Number(payload.result.input?.height)
        : null,
  };
}

/**
 * Enables Cloudflare Stream's MP4 download for a video and returns its URL — distinct from
 * streamPlaybackUrls (HLS manifest/iframe, playback only, no plain file to save). Cloudflare
 * generates the MP4 on first request rather than up front, so a freshly-requested download comes
 * back `ready: false` (still encoding) even though the response already includes the eventual
 * URL; callers that need the file NOW (not just queued) should poll until `ready`. Calling this
 * again for an already-ready download is safe — Cloudflare returns the existing result instead
 * of re-encoding.
 */
export async function enableStreamDownload(uid: string): Promise<{ url: string; ready: boolean }> {
  const { accountId, apiToken } = requireStreamConfig();
  const response = await fetch(
    `${STREAM_API}/accounts/${accountId}/stream/${encodeURIComponent(uid)}/downloads`,
    { method: "POST", headers: streamHeaders(apiToken), signal: AbortSignal.timeout(20_000) },
  );
  const payload = await bestEffort("cloudflare.stream.parse_downloads", () => response.json(), { entityId: uid }) as {
    success?: boolean;
    result?: { default?: { url?: string; status?: string; percentComplete?: string } };
    errors?: Array<{ message?: string }>;
  } | null | undefined;
  if (!response.ok || !payload?.success || !payload.result?.default?.url) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new ApiError(502, `Failed to enable Stream download for ${uid} (${detail}).`);
  }
  return { url: payload.result.default.url, ready: payload.result.default.status === "ready" };
}

/**
 * Cloudflare's one-shot Direct Creator Upload endpoint (createStreamDirectUpload, a plain
 * multipart POST) caps at 200MB -- fine for individual autoclip clips but not for the weekly
 * recap, which concatenates and re-encodes a whole week's clips into one file that regularly
 * exceeds that (confirmed live: a real recap upload 413'd). Larger files need Stream's TUS
 * resumable-upload protocol instead: a creation request returns a per-video PATCH URL (via the
 * `Location` response header) and the video's uid (via `stream-media-id`), then the whole file
 * is PATCHed to that URL in one shot -- fine for anything up to a few GB, well past what a
 * single-week recap will ever produce.
 */
export async function uploadLargeStreamVideo(input: {
  filePath: string;
  meta?: Record<string, string>;
  maxDurationSeconds?: number;
}): Promise<{ uid: string; playbackUrl: string }> {
  const { accountId, apiToken } = requireStreamConfig();
  const fileBuffer = await readFile(input.filePath);
  const metaEntries: Record<string, string> = {
    maxdurationseconds: String(input.maxDurationSeconds ?? HIGHLIGHT_MAX_DURATION_SECONDS),
    requiresignedurls: "false",
    ...(input.meta ?? {}),
  };
  const uploadMetadata = Object.entries(metaEntries)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
    .join(",");
  const createResponse = await fetch(`${STREAM_API}/accounts/${accountId}/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(fileBuffer.byteLength),
      "Upload-Metadata": uploadMetadata,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const uid = createResponse.headers.get("stream-media-id");
  const location = createResponse.headers.get("location");
  if (!createResponse.ok || !uid || !location) {
    throw new ApiError(502, `Failed to create Stream TUS upload (HTTP ${createResponse.status}).`);
  }
  const patchResponse = await fetch(location, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": "0",
      "Content-Type": "application/offset+octet-stream",
    },
    body: fileBuffer,
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!patchResponse.ok) {
    throw new ApiError(502, `Stream TUS upload failed (HTTP ${patchResponse.status}).`);
  }
  // TUS creation doesn't take allowedOrigins the way the JSON direct_upload/copy endpoints do --
  // apply it as a follow-up edit, same call already used to repair pre-fix videos.
  await updateStreamAllowedOrigins(uid).catch((error) => console.error("[WARN] Failed to set allowedOrigins on TUS-uploaded video (non-fatal):", error));
  return { uid, playbackUrl: streamPlaybackUrls(uid).watch };
}

/** One-off repair for a video uploaded before streamAllowedOrigins() included Cloudflare's own
 * watch-page domains -- re-applies the current (correct) allow list to an already-existing
 * video. New uploads don't need this; createStreamDirectUpload already sends the fixed list. */
export async function updateStreamAllowedOrigins(uid: string): Promise<void> {
  const { accountId, apiToken } = requireStreamConfig();
  const response = await fetch(`${STREAM_API}/accounts/${accountId}/stream/${encodeURIComponent(uid)}`, {
    method: "POST",
    headers: streamHeaders(apiToken),
    body: JSON.stringify({ allowedOrigins: streamAllowedOrigins() }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await bestEffort("cloudflare.stream.parse_update_origins", () => response.json(), { entityId: uid }) as { success?: boolean; errors?: Array<{ message?: string }> } | null | undefined;
  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new ApiError(502, `Failed to update Stream allowedOrigins for ${uid} (${detail}).`);
  }
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
