// One-off repair: re-applies the current (correct) Cloudflare Stream allowedOrigins allow list
// to every already-uploaded throwing-motion video. Needed because these were uploaded before
// CLOUDFLARE_STREAM_ALLOWED_ORIGINS included the production site domain -- see
// apps/api/src/lib/cloudflare-stream.ts (streamAllowedOrigins/updateStreamAllowedOrigins).
// Run with CLOUDFLARE_STREAM_ALLOWED_ORIGINS set to the domain(s) that should be allowed, e.g.:
//   CLOUDFLARE_STREAM_ALLOWED_ORIGINS=rec-leagues.com pnpm --filter @rec/api exec tsx scripts/fix-stream-allowed-origins.ts
import { THROWING_MOTIONS } from "@rec/shared";
import { updateStreamAllowedOrigins, requireSignedUrlsOff, streamAllowedOrigins } from "../src/lib/cloudflare-stream.js";

async function main() {
  console.log(`Applying allowedOrigins ${JSON.stringify(streamAllowedOrigins())} to ${THROWING_MOTIONS.length} throwing-motion videos...`);
  let ok = 0;
  const failed: Array<{ key: string; uid: string; error: string }> = [];
  for (const motion of THROWING_MOTIONS) {
    try {
      await updateStreamAllowedOrigins(motion.streamUid);
      await requireSignedUrlsOff(motion.streamUid);
      ok += 1;
      console.log(`  OK  ${motion.key} (${motion.streamUid})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ key: motion.key, uid: motion.streamUid, error: message });
      console.error(`  FAIL ${motion.key} (${motion.streamUid}): ${message}`);
    }
  }
  console.log(`\nDone. ${ok} fixed, ${failed.length} failed.`);
  if (failed.length) {
    console.log(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

await main();
