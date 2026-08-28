import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { sendError, ApiError } from "../../lib/errors.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { enableStreamDownload, updateStreamAllowedOrigins } from "../../lib/cloudflare-stream.js";

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

  app.post("/v1/debug/stream-fix-origins/:uid", async (request, reply) => {
    try {
      requireDebugStreamKey(request.headers["x-debug-key"]);
      const params = z.object({ uid: z.string().min(1) }).parse(request.params);
      await updateStreamAllowedOrigins(params.uid);
      return reply.send({ fixed: true });
    } catch (error) { return sendError(reply, error); }
  });
}
