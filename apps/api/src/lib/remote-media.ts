import { env } from "../config/env.js";
import { ApiError } from "./errors.js";

const DISCORD_MEDIA_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const SUPABASE_HOST = new URL(env.SUPABASE_URL).hostname.toLowerCase();

function assertAllowedMediaUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError(400, "Invalid media URL.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (hostname !== SUPABASE_HOST && !DISCORD_MEDIA_HOSTS.has(hostname))
  ) {
    throw new ApiError(400, "Media must come from a REC upload or Discord attachment.");
  }
  return url;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    throw new ApiError(413, "Media file is too large.");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ApiError(413, "Media file is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchTrustedRemoteMedia(
  rawUrl: string,
  options: { maxBytes: number; timeoutMs: number; expectedTypePrefix: "image/" | "video/" },
): Promise<{ buffer: Buffer; contentType: string; finalUrl: URL }> {
  const requestedUrl = assertAllowedMediaUrl(rawUrl);
  const response = await fetch(requestedUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new ApiError(400, `Media download failed (${response.status}).`);

  const finalUrl = assertAllowedMediaUrl(response.url);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith(options.expectedTypePrefix)) {
    throw new ApiError(400, `Expected ${options.expectedTypePrefix.slice(0, -1)} media.`);
  }
  return {
    buffer: await readLimitedBody(response, options.maxBytes),
    contentType,
    finalUrl,
  };
}
