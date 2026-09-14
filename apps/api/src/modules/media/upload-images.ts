// Generic image re-hosting for browser uploads that need a stable public URL. Used by tournament
// bracket/box-score uploads.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

const BOX_SCORE_IMAGE_BUCKET = "box-scores";

export async function persistUploadedImageBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const ext = contentType === "image/jpeg" ? "jpeg" : contentType === "image/webp" ? "webp" : "png";
  const path = `${key}.${ext}`;
  const { error } = await supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new ApiError(500, "We couldn't upload that image. Please try again.", error);
  const { data } = supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new ApiError(500, "We couldn't finish uploading that image. Please try again.");
  return data.publicUrl;
}
