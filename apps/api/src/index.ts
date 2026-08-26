import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { env, shouldMigrateMirroredHighlightsOnBoot } from "./config/env.js";
import { registerRoutes } from "./routes.js";
import { migrateMirroredHighlightsToStream } from "./modules/media/media.service.js";
import { hasValidInternalApiKey } from "./lib/auth.js";
import { sweepFantasyDraftTimers } from "./modules/fantasy-draft/fantasy-draft.service.js";
import { runSchedulingReminderSweep } from "./modules/scheduling/reminder-poller.service.js";
import { runStreamingSweep } from "./modules/streaming/streaming.service.js";
import { runAutoImportSweep } from "./modules/madden-ea/ea-connections.service.js";
import { runTournamentLotterySweep } from "./modules/tournaments/tournament-lottery.service.js";
import { runTournamentRegistrationAnnounceSweep } from "./modules/tournaments/tournament-discord.service.js";
import { syncAllRecruitingAds } from "./modules/admin/site-discord-config.service.js";
import { supabase } from "./lib/supabase.js";

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
await app.register(websocket);
await registerRoutes(app);
try { await app.listen({ host: env.API_HOST, port: env.API_PORT }); }
catch (error) { app.log.error(error); process.exit(1); }

// Fantasy/offseason draft pick-timer sweep: fires the 15-second-remaining Discord warning and
// auto-skips a pick whose timer has expired. Short interval (not the 60s pattern used
// elsewhere) so a 15-second warning threshold is actually caught in time.
setInterval(() => {
  sweepFantasyDraftTimers().catch((error) => app.log.error({ err: error }, "Fantasy draft timer sweep failed"));
}, 5_000).unref();

// REC Game Scheduling System: 12h-no-attempt / 30m-to-kickoff / kickoff-prompt reminder sweep --
// 5 minutes is plenty of precision for these three thresholds (availability nagging moved to be
// advance-triggered instead of polled -- see league-week.service.ts).
setInterval(() => {
  runSchedulingReminderSweep().catch((error) => app.log.error({ err: error }, "Scheduling reminder sweep failed"));
}, 5 * 60_000).unref();

setInterval(() => {
  runStreamingSweep().catch((error) => app.log.error({ err: error }, "Streaming account sweep failed"));
}, 60_000).unref();

// Tournament lottery draft: T-30/10/1min reminders, auto-run at the scheduled time, per-pick
// deadline auto-skip, and open-pool auto-assignment -- same restart-safe polled pattern.
setInterval(() => {
  runTournamentLotterySweep().catch((error) => app.log.error({ err: error }, "Tournament lottery sweep failed"));
}, 60_000).unref();

// Fires the @everyone "registration is open" ping once a tournament's scheduled
// registrationOpensAt actually arrives, for tournaments created with a future open time.
setInterval(() => {
  runTournamentRegistrationAnnounceSweep().catch((error) => app.log.error({ err: error }, "Tournament registration announce sweep failed"));
}, 60_000).unref();

// Auto-import sweep for EA-connected leagues with auto_import enabled — pulls fresh data every
// 4 hours instead of waiting for a commissioner to click "Import Now," which also keeps each
// connection's session active so EA's ten-day-inactivity refresh_token expiry never gets hit.
// setInterval alone only fires after the first 4-hour period elapses, so a league whose sweep
// window keeps getting reset by a redeploy (routine on this platform) could go long stretches
// without ever actually running — run once at boot too, same as the other sweeps' effectively
// immediate first tick from their much shorter (60s) intervals.
function runEaAutoImportSweep() {
  runAutoImportSweep()
    .then((result) => { if (result.attempted) app.log.info(result, "EA auto-import sweep completed"); })
    .catch((error) => app.log.error({ err: error }, "EA auto-import sweep failed"));
}
runEaAutoImportSweep();
setInterval(runEaAutoImportSweep, 4 * 60 * 60_000).unref();

// One-shot: if league-post channels are configured but no recruiting ads exist yet (e.g. channels
// were written directly in Supabase), backfill open-league embeds once on boot.
void (async () => {
  try {
    const existing = await supabase.from("rec_league_recruiting_ads").select("league_id").limit(1);
    if ((existing.data?.length ?? 0) > 0) return;
    const result = await syncAllRecruitingAds();
    if (result.synced.length) {
      console.log("[recruiting-ads] Boot backfill synced games:", result.synced.join(", "));
    }
  } catch (error) {
    console.error("[recruiting-ads] Boot backfill failed (non-fatal)", error);
  }
})();

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
