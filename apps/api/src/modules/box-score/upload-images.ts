// Generic screenshot re-hosting, shared by every feature that accepts a Discord CDN image URL
// (which dies once the source message is deleted) or a raw browser upload and needs a stable
// public URL — the Comp ladder's box-score parsing, schedule-screenshot flows, and weekly-scores
// all reuse this. Lives alongside the OCR parser files (box-score.parser.ts etc.) since it was
// originally part of the league box-score submission workflow before that was removed in favor
// of EA import; this utility itself has nothing league-specific about it.
import sharp from "sharp";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { fetchImageBuffer } from "./box-score.parser.js";

const BOX_SCORE_IMAGE_BUCKET = "box-scores";

// Re-host a Discord screenshot to the public bucket and return its stable URL. Non-fatal:
// returns null on any failure, callers fall back to the CDN URL.
export async function persistUploadImage(key: string, imageUrl: string): Promise<string | null> {
  try {
    const buffer = await fetchImageBuffer(imageUrl);
    const ext = (/\.(jpe?g|webp|png)/i.exec(imageUrl)?.[1] ?? "png").toLowerCase();
    const normalizedExt = ext === "jpg" ? "jpeg" : ext;
    const contentType = normalizedExt === "jpeg" ? "image/jpeg" : normalizedExt === "webp" ? "image/webp" : "image/png";
    const path = `${key}.${normalizedExt}`;
    const { error } = await supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error("[WARN] Failed to upload screenshot to storage (non-fatal):", error);
      return null;
    }
    const { data } = supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error("[WARN] Failed to re-host screenshot (non-fatal):", err);
    return null;
  }
}

// Web dashboard equivalent of persistUploadImage — a browser upload arrives as a raw file.
// Uploads it directly and returns its public URL (throws on failure rather than falling back to
// null, since there's no CDN URL to fall back to here).
export async function persistUploadedImageBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const ext = contentType === "image/jpeg" ? "jpeg" : contentType === "image/webp" ? "webp" : "png";
  const path = `${key}.${ext}`;
  const { error } = await supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new ApiError(500, "We couldn't upload that image. Please try again.", error);
  const { data } = supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new ApiError(500, "We couldn't finish uploading that image. Please try again.");
  return data.publicUrl;
}

// Re-host one or more screenshots as a SINGLE image (stacked vertically) so an embed — which
// only renders one image — can show every uploaded shot. Falls back to re-hosting the first
// image, then to its CDN URL, on any failure.
export async function persistStitchedUploadImage(key: string, imageUrls: string[]): Promise<string | null> {
  const urls = imageUrls.filter(Boolean);
  if (urls.length <= 1) return persistUploadImage(key, urls[0] ?? "");
  try {
    const buffers = await Promise.all(urls.map(fetchImageBuffer));
    const width = Math.max(...(await Promise.all(buffers.map(async (b) => (await sharp(b).metadata()).width ?? 0))));
    const tiles = await Promise.all(buffers.map((b) => sharp(b).resize({ width, fit: "inside" }).png().toBuffer()));
    const heights = await Promise.all(tiles.map(async (t) => (await sharp(t).metadata()).height ?? 0));
    const totalHeight = heights.reduce((s, h) => s + h, 0);
    let top = 0;
    const composite = tiles.map((input, i) => {
      const layer = { input, top, left: 0 };
      top += heights[i];
      return layer;
    });
    const stitched = await sharp({ create: { width, height: totalHeight, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite(composite)
      .png()
      .toBuffer();
    const path = `${key}.png`;
    const { error } = await supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).upload(path, stitched, { contentType: "image/png", upsert: true });
    if (error) {
      console.error("[WARN] Failed to upload stitched screenshot (non-fatal):", error);
      return persistUploadImage(key, urls[0]);
    }
    const { data } = supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? (await persistUploadImage(key, urls[0]));
  } catch (err) {
    console.error("[WARN] Failed to stitch screenshots (non-fatal):", err);
    return persistUploadImage(key, urls[0]);
  }
}
