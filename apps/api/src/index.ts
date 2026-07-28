import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env, shouldMigrateMirroredHighlightsOnBoot } from "./config/env.js";
import { registerRoutes } from "./routes.js";
import { migrateMirroredHighlightsToStream } from "./modules/media/media.service.js";
import { hasValidInternalApiKey } from "./lib/auth.js";

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 16 * 1024 * 1024 });
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});
await app.register(cors, {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = new Set(
      [
        env.SITE_PUBLIC_URL,
        env.WEB_APP_URL,
        ...(env.API_CORS_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? []),
        ...(env.NODE_ENV === "production" ? [] : ["http://localhost:5173", "http://localhost:5174"]),
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => new URL(value).origin),
    );
    callback(null, allowed.has(origin));
  },
  allowedHeaders: ["authorization", "content-type", "x-rec-api-key", "x-rec-guild-id", "webhook-signature", "stripe-signature"],
});
await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute",
  allowList(request) {
    return hasValidInternalApiKey(request);
  },
});
// Preserve raw JSON for Cloudflare Stream webhook HMAC verification.
app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  const raw = typeof body === "string" ? body : body.toString("utf8");
  (request as { rawBody?: string }).rawBody = raw;
  try {
    done(null, raw ? JSON.parse(raw) : {});
  } catch (error) {
    done(error as Error, undefined);
  }
});
// 15MB cap — generous for a phone screenshot, small enough to bound abuse of the one
// unauthenticated-by-file-size-only surface (upload-image is still auth-guarded, this is
// just a sanity limit on request body size).
await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
await registerRoutes(app);
try { await app.listen({ host: env.API_HOST, port: env.API_PORT }); }
catch (error) { app.log.error(error); process.exit(1); }

const migrateOnBoot = shouldMigrateMirroredHighlightsOnBoot();
app.log.info(
  {
    migrateOnBoot,
    migrateFlagRaw: process.env.MIGRATE_MIRRORED_HIGHLIGHTS_ON_BOOT ?? null,
  },
  "Highlight Stream migration boot check",
);

if (migrateOnBoot) {
  app.log.info("MIGRATE_MIRRORED_HIGHLIGHTS_ON_BOOT set — copying mirrored highlights into Stream…");
  try {
    const result = await migrateMirroredHighlightsToStream({ limit: 100 });
    // Railway's log UI often drops pino object fields — also emit a plain JSON line.
    console.log(
      "[migrate-mirrored-highlights]",
      JSON.stringify({
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        results: result.results,
      }),
    );
    app.log.info(
      {
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        results: result.results,
      },
      "Mirrored highlight → Stream migration finished",
    );
  } catch (error) {
    console.error("[migrate-mirrored-highlights] failed", error);
    app.log.error({ err: error }, "Mirrored highlight → Stream migration failed");
  }
}
