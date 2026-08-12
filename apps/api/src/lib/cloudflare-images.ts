import { env } from "../config/env.js";
import { bestEffort } from "./best-effort.js";
import { ApiError } from "./errors.js";

const IMAGES_API = "https://api.cloudflare.com/client/v4";

function requireImagesConfig() {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new ApiError(503, "Cloudflare Images is not configured on this API.");
  }
  return { accountId, apiToken, accountHash: env.CLOUDFLARE_ACCOUNT_HASH?.trim() ?? "" };
}

type UploadPayload = {
  success?: boolean;
  result?: { id?: string; variants?: string[] };
  errors?: Array<{ code?: number; message?: string }>;
} | null;

export function deliveryUrl(accountHash: string, id: string, variants?: string[]): string {
  return accountHash ? `https://imagedelivery.net/${accountHash}/${id}/public` : variants?.[0] ?? "";
}

async function deleteImage(accountId: string, apiToken: string, imageId: string): Promise<boolean> {
  const res = await fetch(`${IMAGES_API}/accounts/${accountId}/images/v1/${imageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  return res.ok || res.status === 404;
}

/**
 * Upload a binary image to Cloudflare Images (see docs/madden-fantasy-draft-plan.md §8/§11).
 * The account token needs Images:Edit permission. A stable `imageId` (e.g. the rec_players
 * UUID) makes re-uploads replace the same image: Cloudflare rejects a duplicate custom ID,
 * so on that error we delete the existing image and retry once — headshot re-uploads and
 * seed re-runs both land on this path. Returns the delivery URL for the `public` variant —
 * built from the account hash when present, otherwise the API's first variant. The original
 * binary is never served to end users.
 */
export async function uploadImageToCloudflare(input: {
  buffer: Buffer;
  contentType: string;
  imageId?: string;
  meta?: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const { accountId, apiToken, accountHash } = requireImagesConfig();

  const buildForm = () => {
    const form = new FormData();
    const extension = input.contentType === "image/jpeg" ? "jpg" : input.contentType === "image/webp" ? "webp" : input.contentType === "image/gif" ? "gif" : "png";
    const bytes = new Uint8Array(input.buffer);
    form.append("file", new Blob([bytes], { type: input.contentType }), `headshot.${extension}`);
    form.append("requireSignedURLs", "false");
    if (input.imageId) form.append("id", input.imageId);
    if (input.meta && Object.keys(input.meta).length) form.append("metadata", JSON.stringify(input.meta));
    return form;
  };

  const attempt = async (): Promise<{ ok: boolean; status: number; payload: UploadPayload }> => {
    const response = await fetch(`${IMAGES_API}/accounts/${accountId}/images/v1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: buildForm(),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await bestEffort("cloudflare.images.parse_upload", () => response.json(), {}) as UploadPayload;
    return { ok: response.ok, status: response.status, payload };
  };

  const existingError = (p: UploadPayload) => p?.errors?.some((e) => e.message?.toLowerCase().includes("already exists"));

  let { ok, status, payload } = await attempt();
  if (!ok && input.imageId && existingError(payload)) {
    // Cloudflare rejects re-uploads to a custom ID that already exists — delete and retry
    // once so the new binary genuinely replaces the old image.
    if (await deleteImage(accountId, apiToken, input.imageId)) {
      ({ ok, status, payload } = await attempt());
    }
  }

  const id = payload?.result?.id ?? null;
  if (!ok || !payload?.success || !id) {
    const detail = payload?.errors?.[0]?.message ?? `HTTP ${status}`;
    throw new ApiError(502, `Failed to upload image to Cloudflare (${detail}).`);
  }
  return { id, url: deliveryUrl(accountHash, id, payload.result?.variants) };
}
