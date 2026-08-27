// Pulls additional timestamps from the M27 league's already-uploaded highlight clips via
// Cloudflare Stream's public thumbnail endpoint (works with no auth since these streams are
// created with requireSignedURLs: false -- see docs/scorebug-ocr-regions.md). Run from apps/api:
//   node src/modules/scorebug-ocr/fetch-more-samples.mjs
// Output goes to ocr-samples-extra/ (gitignored), separate from the original ocr-samples/ batch
// so the two can be stress-tested independently to check the fixes generalize rather than being
// overfit to one batch. Update `uids` by re-querying rec_highlight_posts for the league if new
// clips get uploaded (see docs/scorebug-ocr-regions.md for the query).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const uids = [
  "e9ddf06ee753a8c77dcac82a6aaf64ff",
  "29d3e796acf0f15e9d30d2740572d16b",
  "0ae9de48c4bb34c076c71c3194a12e3f",
  "1c73eb3f70b8d07679f3601214526340",
  "2256e3254707895190921fde67ea0ef4",
  "c0544bf90226d026b5835d686048e4d2",
  "1b49d99cf21061b8ae13d315a807997b",
  "9b6336f9bacc9668f14c774ff1b5e451",
  "60ea1bc9809bc41107e50ddc3d08dc4f",
  "9d57dc737a880ea5a4b816211d0d3798",
  "adc11eaa9f0cceff7be14c02bf54e7a0",
  "48310ccc1e075b6c3a0e84b3e4308052",
  "88aa0d03998b47537ac19dfc9db98efd",
  "bafcaac723486e8732593307b9533c1c",
  "24bda6669adc623d73f26565c74e22fc",
  "f9ddca379ab8ce43a95b8416a0037525",
  "a5eefdc3d94cb4cf00f9e9a50fcf2661",
];

const timestamps = [4, 6, 8];
const outDir = "src/modules/scorebug-ocr/ocr-samples-extra";
mkdirSync(outDir, { recursive: true });

let fetched = 0;
for (const uid of uids) {
  for (const t of timestamps) {
    const url = `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=${t}s&width=1920&height=1080`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`skip ${uid}@${t}s: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) {
        console.log(`skip ${uid}@${t}s: suspiciously small (${buf.length}b)`);
        continue;
      }
      writeFileSync(join(outDir, `${uid}_t${t}.jpg`), buf);
      fetched++;
      console.log(`ok ${uid}@${t}s (${buf.length}b)`);
    } catch (e) {
      console.log(`error ${uid}@${t}s:`, e.message);
    }
  }
}
console.log(`\nFetched ${fetched} frames into ${outDir}`);
