// Backfill the photo_url rows that madden-baseline-seed.ts couldn't complete — the seed's
// bulk pass burst ~3,000 downloads at the source site in a few minutes and got throttled
// partway through, leaving some rows with photo_url = ''. This re-runs just those rows:
// source URL from madden27_player_photos.csv, download -> binary upload to Cloudflare
// Images, PATCH the row. Idempotent and resumable (only empty photo_url rows are picked up).
//
// Run: pnpm --filter @rec/api exec tsx scripts/madden-photo-backfill.ts
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const GAME_TITLE = "madden_27";
const CF_IMAGES_API = "https://api.cloudflare.com/client/v4";

const REST_URL = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function uploadPhoto(sourceUrl: string, slug: string): Promise<string> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID!.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN!.trim();
  const accountHash = env.CLOUDFLARE_ACCOUNT_HASH?.trim() ?? "";

  async function attempt(): Promise<string> {
    try {
      const dl = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!dl.ok) return "";
      const buf = await dl.arrayBuffer();
      const form = new FormData();
      form.set("file", new Blob([buf], { type: dl.headers.get("content-type") ?? "image/png" }), `${slug}.png`);
      form.set("id", `madden27-${slug}`);
      form.set("requireSignedURLs", "false");
      const res = await fetch(`${CF_IMAGES_API}/accounts/${accountId}/images/v1`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await res.json().catch(() => null) as { success?: boolean; result?: { variants?: string[] }; errors?: Array<{ message?: string }> } | null;
      if (!res.ok || !payload?.success || !payload.result?.id) {
        const dup = payload?.errors?.some((e) => e.message?.toLowerCase().includes("already exists"));
        if (dup) {
          await fetch(`${CF_IMAGES_API}/accounts/${accountId}/images/v1/madden27-${slug}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiToken}` },
          }).catch(() => {});
        }
        return "";
      }
      return accountHash
        ? `https://imagedelivery.net/${accountHash}/madden27-${slug}/public`
        : payload.result.variants?.[0] ?? "";
    } catch {
      return "";
    }
  }

  const backoffs = [0, 3000, 8000, 20000];
  for (const backoff of backoffs) {
    if (backoff) await sleep(backoff);
    const url = await attempt();
    if (url) return url;
  }
  return "";
}

async function main() {
  if (!existsSync(join(DATA_DIR, "madden27_player_photos.csv"))) {
    throw new Error("Missing madden27_player_photos.csv — run scrape-madden-photos.ts first.");
  }
  const photoMap = new Map<string, string>();
  for (const row of parseCsv(readFileSync(join(DATA_DIR, "madden27_player_photos.csv"), "utf8"))) if (row.id && row.image) photoMap.set(row.id, row.image);
  // Stub players' photos live in the unrated CSV's `image` column, not the rated-photo map.
  const stubsPath = join(DATA_DIR, "madden27_unrated_players_final.csv");
  if (existsSync(stubsPath)) {
    for (const row of parseCsv(readFileSync(stubsPath, "utf8"))) {
      const slug = row.url?.replace(/^https?:\/\/www\.maddenratings\.com\//, "").replace(/\/$/, "");
      if (slug && !photoMap.has(slug) && row.image) photoMap.set(slug, row.image);
    }
  }
  console.log(`Loaded ${photoMap.size} photo URLs.`);

  const dataset = await fetch(`${REST_URL}/rec_madden_roster_datasets?select=id&game_title=eq.${GAME_TITLE}&is_active=eq.true`, {
    headers: restHeaders(),
  }).then((r) => r.json()) as Array<{ id: string }>;
  if (!dataset.length) throw new Error("No active madden_27 dataset found.");
  const datasetId = dataset[0].id;

  const all: Array<{ id: string; source_slug: string; photo_url: string }> = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const rows = await fetch(
      `${REST_URL}/rec_madden_baseline_players?select=id,source_slug,photo_url&dataset_id=eq.${datasetId}&offset=${offset}&limit=1000`,
      { headers: restHeaders() },
    ).then((r) => r.json()) as Array<{ id: string; source_slug: string; photo_url: string }>;
    if (!rows.length) break;
    all.push(...rows);
  }
  const targets = all.filter((r) => !r.photo_url);
  const noSource = targets.filter((r) => !photoMap.has(r.source_slug));
  console.log(`Dataset ${datasetId}: ${all.length} players, ${targets.length} missing photo_url, ${noSource.length} of those have no known source URL.`);

  const queue = targets.filter((r) => photoMap.has(r.source_slug));
  let done = 0, ok = 0, fail = 0, consecutiveFails = 0;
  let next = 0;
  const CONCURRENCY = 4;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < queue.length) {
        const row = queue[next++];
        const hosted = await uploadPhoto(photoMap.get(row.source_slug)!, row.source_slug);
        if (hosted) {
          await fetch(`${REST_URL}/rec_madden_baseline_players?id=eq.${row.id}`, {
            method: "PATCH",
            headers: restHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({ photo_url: hosted }),
          }).catch(() => {});
          ok++;
          consecutiveFails = 0;
        } else {
          fail++;
          consecutiveFails++;
          console.warn(`  failed ${row.source_slug}`);
        }
        done++;
        if (done % 100 === 0 || done === queue.length) {
          console.log(`  backfilled ${done}/${queue.length} (ok=${ok} fail=${fail})`);
        }
        await sleep(120 + (consecutiveFails > 2 ? 2000 : 0));
      }
    }),
  );
  console.log(`Done. backfilled ${ok}/${queue.length}, ${fail} still missing.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
