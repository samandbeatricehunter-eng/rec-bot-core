import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { sendError, ApiError } from "../../lib/errors.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { enableStreamDownload, updateStreamAllowedOrigins } from "../../lib/cloudflare-stream.js";
import { SCOREBUG_REGIONS, SCOREBUG_REGIONS_NO_TICKER, regionToPixels } from "../scorebug-ocr/scorebug-regions.js";

const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

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
export async function debugStreamDownloadRoutes(app: FastifyInstance) {
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
      const { stdout } = await execFileAsync(FFMPEG, ["-loglevel", "error", "-ss", String(query.second), "-i", job.data.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
      return reply.header("content-type", "image/jpeg").send(stdout);
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
      const { stdout: frameJpeg } = await execFileAsync(FFMPEG, ["-loglevel", "error", "-ss", String(query.second), "-i", job.data.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
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
        return sharp({ create: { width: rowWidth, height: rowHeight, channels: 3, background: "#333" } }).composite(composites).toBuffer();
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

  app.post("/v1/debug/stream-fix-origins/:uid", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ uid: z.string().min(1) }).parse(request.params);
      await updateStreamAllowedOrigins(params.uid);
      return reply.send({ fixed: true });
    } catch (error) { return sendError(reply, error); }
  });
}
