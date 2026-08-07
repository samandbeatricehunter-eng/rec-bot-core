import { env } from "../config/env.js";
import { ApiError } from "./errors.js";

const IMAGES_API = "https://api.cloudflare.com/client/v4";

function requireImagesConfig() {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new ApiError(503, "Cloudflare Images is not configured on this API.");
  }
  return { accountId, apiToken };
}

/**
 * Upload a binary image to Cloudflare Images (see docs/madden-fantasy-draft-plan.md §8/§11).
 * The account token needs Images:Edit permission. A stable `imageId` (e.g. the rec_players
 * UUID) makes re-uploads replace the same image instead of accumulating copies. Returns the
 * first delivery variant URL (imagedelivery.net/.../public) — serve that directly; the
 * original binary is never served to end users.
 */
export async function uploadImageToCloudflare(input: {
  buffer: Buffer;
  contentType: string;
  imageId?: string;
  meta?: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const { accountId, apiToken } = requireImagesConfig();

  const form = new FormData();
  const extension = input.contentType === "image/jpeg" ? "jpg" : input.contentType === "image/webp" ? "webp" : input.contentType === "image/gif" ? "gif" : "png";
  const bytes = new Uint8Array(input.buffer);
  form.append("file", new Blob([bytes], { type: input.contentType }), `headshot.${extension}`);
  form.append("requireSignedURLs", "false");
  if (input.imageId) form.append("id", input.imageId);
  if (input.meta && Object.keys(input.meta).length) form.append("metadata", JSON.stringify(input.meta));

  const response = await fetch(`${IMAGES_API}/accounts/${accountId}/images/v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    result?: { id?: string; variants?: string[] };
    errors?: Array<{ message?: string }>;
  } | null;
  const variant = payload?.result?.variants?.[0] ?? null;
  if (!response.ok || !payload?.success || !payload.result?.id || !variant) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    throw new ApiError(502, `Failed to upload image to Cloudflare (${detail}).`);
  }
  return { id: payload.result.id, url: variant };
}
