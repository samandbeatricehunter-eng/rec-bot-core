import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { sendError, ApiError } from "../../lib/errors.js";
import { createStreamDirectUpload, deleteStreamVideo, enableStreamDownload, requireSignedUrlsOff, streamPlaybackUrls, updateStreamAllowedOrigins } from "../../lib/cloudflare-stream.js";

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

  // A plain <video src> (the intro-video gate's anti-skip controls need direct DOM/JS access
  // to the element, which an iframe embed doesn't expose) needs a real downloadable MP4, not
  // the HLS manifest -- this enables and returns that direct file URL for a given upload.
  app.get("/v1/debug/rti-video-download-url/:uid", async (request, reply) => {
    try {
      requireRtiVideoUploadKey(request.headers["x-upload-key"]);
      const params = z.object({ uid: z.string().min(1) }).parse(request.params);
      let result = await enableStreamDownload(params.uid);
      for (let attempt = 0; attempt < 8 && !result.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        result = await enableStreamDownload(params.uid);
      }
      return reply.send(result);
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
