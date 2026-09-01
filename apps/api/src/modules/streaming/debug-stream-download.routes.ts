import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { sendError, ApiError } from "../../lib/errors.js";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { createStreamDirectUpload, deleteStreamVideo, enableStreamDownload, requireSignedUrlsOff, streamPlaybackUrls, updateStreamAllowedOrigins } from "../../lib/cloudflare-stream.js";
import { SCOREBUG_REGIONS, SCOREBUG_REGIONS_NO_TICKER, regionToPixels } from "../scorebug-ocr/scorebug-regions.js";

const FFMPEG = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

// Mirrors outputBuffer() in stream-autoclip.service.ts, the pattern the real OCR pipeline uses
// to extract a single frame as a Buffer for Sharp to decode.
async function ffmpegFrameBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; const errors: Buffer[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errors).toString("utf8").slice(-2000))));
  });
}

function requireDebugStreamKey(header: string | string[] | undefined) {
  if (!env.DEBUG_STREAM_KEY) throw new ApiError(404, "Not found.");
  const provided = Array.isArray(header) ? header[0] : header;
  const expected = Buffer.from(env.DEBUG_STREAM_KEY);
  const actual = Buffer.from(provided ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError(401, "Invalid debug key.");
  }
}

/** Temporary ops-only route: resolves a Cloudflare Stream video's downloadable MP4 URL
 * server-side, for pulling a specific video's bytes when the public watch page rejects
 * playback (e.g. allowedOrigins has no match for a bare link opened outside the site).
 * Gated by DEBUG_STREAM_KEY, unset in prod by default -- remove once no longer needed. */
function requireRtiVideoUploadKey(header: string | string[] | undefined) {
  if (!env.RTI_VIDEO_UPLOAD_KEY) throw new ApiError(404, "Not found.");
  const provided = Array.isArray(header) ? header[0] : header;
  const expected = Buffer.from(env.RTI_VIDEO_UPLOAD_KEY);
  const actual = Buffer.from(provided ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError(401, "Invalid upload key.");
  }
}

export async function debugStreamDownloadRoutes(app: FastifyInstance) {
  // One-time ops helper: hands back a Cloudflare Stream direct-upload URL so a large local
  // video file (the Rise to Immortality intro video) can be pushed straight from a terminal
  // curl without going through any site upload UI. Gated by its own key, separate from
  // DEBUG_STREAM_KEY, so setting this up doesn't require knowing or rotating that one.
  app.post("/v1/debug/rti-video-upload-url", async (request, reply) => {
    try {
      requireRtiVideoUploadKey(request.headers["x-upload-key"]);
      const result = await createStreamDirectUpload({ maxDurationSeconds: 1800, meta: { name: "rti-intro-video" } });
      return reply.send({ uid: result.uid, uploadURL: result.uploadURL, playback: streamPlaybackUrls(result.uid) });
    } catch (error) { return sendError(reply, error); }
  });


  app.get("/v1/debug/stream-download/:uid", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ uid: z.string().min(1) }).parse(request.params);
      let result = await enableStreamDownload(params.uid);
      for (let attempt = 0; attempt < 6 && !result.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        result = await enableStreamDownload(params.uid);
      }
      return reply.send(result);
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/debug/capture-frame/:jobId", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ jobId: z.string().min(1) }).parse(request.params);
      const query = z.object({ second: z.coerce.number().min(0) }).parse(request.query);
      const { supabase } = await import("../../lib/supabase.js");
      const job = await supabase.from("rec_stream_capture_jobs").select("capture_path").eq("id", params.jobId).maybeSingle();
      if (job.error) throw job.error;
      if (!job.data?.capture_path) throw new ApiError(404, "Capture job or its recording path not found.");
      const frame = await ffmpegFrameBuffer(["-loglevel", "error", "-ss", String(query.second), "-i", job.data.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
      return reply.header("content-type", "image/jpeg").send(frame);
    } catch (error) { return sendError(reply, error); }
  });

  // Composites the exact awayScore/homeScore/quarter/gameClock/downDistance crop regions
  // (both the "ticker" and "no_ticker" calibrations) into one image, scaled up 4x, so a
  // misalignment between the calibrated crop coordinates and this footage's actual scorebug
  // position is visible directly rather than inferred from OCR output alone.
  app.get("/v1/debug/capture-frame-crops/:jobId", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ jobId: z.string().min(1) }).parse(request.params);
      const query = z.object({ second: z.coerce.number().min(0) }).parse(request.query);
      const { supabase } = await import("../../lib/supabase.js");
      const job = await supabase.from("rec_stream_capture_jobs").select("capture_path").eq("id", params.jobId).maybeSingle();
      if (job.error) throw job.error;
      if (!job.data?.capture_path) throw new ApiError(404, "Capture job or its recording path not found.");
      const frameJpeg = await ffmpegFrameBuffer(["-loglevel", "error", "-ss", String(query.second), "-i", job.data.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
      const meta = await sharp(frameJpeg).metadata();
      const frameWidth = meta.width ?? 1920;
      const frameHeight = meta.height ?? 1080;
      const SCALE = 4;
      const fields = ["awayScore", "homeScore", "quarter", "gameClock", "downDistance"] as const;

      async function cropRow(regions: typeof SCOREBUG_REGIONS | typeof SCOREBUG_REGIONS_NO_TICKER) {
        const crops = await Promise.all(fields.map(async (field) => {
          const pixels = regionToPixels(regions[field], frameWidth, frameHeight);
          const buffer = await sharp(frameJpeg).extract(pixels).resize(pixels.width * SCALE, pixels.height * SCALE, { kernel: "nearest" }).toBuffer();
          return { buffer, ...(await sharp(buffer).metadata()) };
        }));
        const rowHeight = Math.max(...crops.map((c) => c.height ?? 0));
        const rowWidth = crops.reduce((sum, c) => sum + (c.width ?? 0) + 12, 0);
        let left = 0;
        const composites = crops.map((c) => {
          const entry = { input: c.buffer, left, top: 0 };
          left += (c.width ?? 0) + 12;
          return entry;
        });
        return sharp({ create: { width: rowWidth, height: rowHeight, channels: 3, background: "#333" } }).composite(composites).png().toBuffer();
      }

      const [tickerRow, noTickerRow] = await Promise.all([cropRow(SCOREBUG_REGIONS), cropRow(SCOREBUG_REGIONS_NO_TICKER)]);
      const [tickerMeta, noTickerMeta] = await Promise.all([sharp(tickerRow).metadata(), sharp(noTickerRow).metadata()]);
      const outWidth = Math.max(tickerMeta.width ?? 0, noTickerMeta.width ?? 0);
      const gap = 20;
      const outHeight = (tickerMeta.height ?? 0) + gap + (noTickerMeta.height ?? 0);
      const output = await sharp({ create: { width: outWidth, height: outHeight, channels: 3, background: "#000" } })
        .composite([{ input: tickerRow, left: 0, top: 0 }, { input: noTickerRow, left: 0, top: (tickerMeta.height ?? 0) + gap }])
        .png().toBuffer();
      return reply.header("content-type", "image/png").send(output);
    } catch (error) { return sendError(reply, error); }
  });

  // Arbitrary fractional crop (x0/x1/y0/y1 in [0,1], optional scale) for manually re-measuring
  // scorebug region boundaries pixel-by-pixel against a specific stream's actual footage --
  // same iterative approach the original calibration in scorebug-regions.ts used.
  app.get("/v1/debug/capture-frame-region/:jobId", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ jobId: z.string().min(1) }).parse(request.params);
      const query = z.object({
        second: z.coerce.number().min(0),
        x0: z.coerce.number().min(0).max(1).default(0),
        x1: z.coerce.number().min(0).max(1).default(1),
        y0: z.coerce.number().min(0).max(1).default(0),
        y1: z.coerce.number().min(0).max(1).default(1),
        scale: z.coerce.number().min(1).max(8).default(1),
      }).parse(request.query);
      const { supabase } = await import("../../lib/supabase.js");
      const job = await supabase.from("rec_stream_capture_jobs").select("capture_path").eq("id", params.jobId).maybeSingle();
      if (job.error) throw job.error;
      if (!job.data?.capture_path) throw new ApiError(404, "Capture job or its recording path not found.");
      const frameJpeg = await ffmpegFrameBuffer(["-loglevel", "error", "-ss", String(query.second), "-i", job.data.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
      const meta = await sharp(frameJpeg).metadata();
      const frameWidth = meta.width ?? 1920;
      const frameHeight = meta.height ?? 1080;
      const pixels = regionToPixels({ x0: query.x0, x1: query.x1, y0: query.y0, y1: query.y1 }, frameWidth, frameHeight);
      const output = await sharp(frameJpeg).extract(pixels)
        .resize(pixels.width * query.scale, pixels.height * query.scale, { kernel: "nearest" })
        .png().toBuffer();
      return reply.header("content-type", "image/png").header("x-frame-size", `${frameWidth}x${frameHeight}`).header("x-crop-px", `${pixels.left},${pixels.top},${pixels.width},${pixels.height}`).send(output);
    } catch (error) { return sendError(reply, error); }
  });

  // Bulk-delete garbage test clips from Cloudflare Stream -- cleanup for a live test run, not a
  // production feature. Deletes best-effort (one failure doesn't stop the rest) and reports which
  // uids failed.
  app.post("/v1/debug/stream-bulk-delete", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const body = z.object({ uids: z.array(z.string().min(1)).min(1).max(500) }).parse(request.body ?? {});
      const failures: Array<{ uid: string; error: string }> = [];
      for (const uid of body.uids) {
        try { await deleteStreamVideo(uid); }
        catch (error) { failures.push({ uid, error: error instanceof Error ? error.message : String(error) }); }
      }
      return reply.send({ deleted: body.uids.length - failures.length, failed: failures });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/debug/stream-fix-origins/:uid", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ uid: z.string().min(1) }).parse(request.params);
      await updateStreamAllowedOrigins(params.uid);
      await requireSignedUrlsOff(params.uid);
      return reply.send({ fixed: true });
    } catch (error) { return sendError(reply, error); }
  });
}
