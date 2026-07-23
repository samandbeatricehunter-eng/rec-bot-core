import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env, shouldMigrateMirroredHighlightsOnBoot } from "./config/env.js";
import { registerRoutes } from "./routes.js";
import { migrateMirroredHighlightsToStream } from "./modules/media/media.service.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
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
