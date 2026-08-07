// One-off scraper: fetch each rated Madden 27 player page and extract the real photo URL
// from its og:image meta tag. Builds apps/api/scripts/data/madden27/madden27_player_photos.csv
// (id = site slug, image = direct wp-content/uploads photo URL) — the missing link for
// re-hosting photos on Cloudflare (§1/§8 of the plan doc). Not part of the seed; re-run
// manually whenever the site's photo set changes.
//
// Run: pnpm --filter @rec/api exec tsx scripts/scrape-madden-photos.ts
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const OUT = join(DATA_DIR, "madden27_player_photos.csv");

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

function slugFromUrl(url: string): string {
  return url.replace(/^https?:\/\/www\.maddenratings\.com\//, "").replace(/\/$/, "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPhotoUrl(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return "";
  const html = await res.text();
  const og = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ?? "";
  if (!og) return "";
  const inSrc = html.includes(`src="${og}"`);
  if (inSrc) return og;
  return /-madden-photo\.(?:png|jpg|jpeg|webp)/i.test(og) ? og : "";
}

async function main() {
  const ratedRows = [
    ...parseCsv(readFileSync(join(DATA_DIR, "madden27_all_rosters.csv"), "utf8")),
    ...parseCsv(readFileSync(join(DATA_DIR, "madden27_free_agents.csv"), "utf8")),
  ];
  const slugs = ratedRows.map((r) => slugFromUrl(r.url)).filter(Boolean);
  const uniqueSlugs = [...new Set(slugs)];
  console.log(`Scraping ${uniqueSlugs.length} player pages...`);

  const already: Record<string, string> = {};
  if (existsSync(OUT)) {
    for (const r of parseCsv(readFileSync(OUT, "utf8"))) if (r.id) already[r.id] = r.image;
    console.log(`Resuming with ${Object.keys(already).length} already-scraped entries.`);
  }

  const lines: string[] = [];
  let found = 0;
  const CONCURRENCY = 6;
  let next = 0;
  const queue = uniqueSlugs.filter((s) => !(s in already));
  const done = { count: 0 };
  if (queue.length && !existsSync(OUT)) writeFileSync(OUT, "id,image\n");
  let pendingFlush: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < queue.length) {
        const slug = queue[next++];
        let url = "";
        try {
          url = await fetchPhotoUrl(`https://www.maddenratings.com/${slug}`);
        } catch {
          url = "";
        }
        done.count++;
        if (url) found++;
        const line = `${slug},"${url.replace(/"/g, '""')}"`;
        pendingFlush.push(line);
        already[slug] = url;
        if (pendingFlush.length >= 50) {
          appendFileSync(OUT, pendingFlush.join("\n") + "\n");
          pendingFlush = [];
        }
        if (done.count % 100 === 0) console.log(`  scraped ${done.count}/${queue.length} (${found} photos so far)`);
        await sleep(80);
      }
    }),
  );
  if (pendingFlush.length) appendFileSync(OUT, pendingFlush.join("\n") + "\n");
  const withPhoto = Object.values(already).filter(Boolean).length;
  console.log(`Done: ${uniqueSlugs.length} players, ${withPhoto} with photos, ${uniqueSlugs.length - withPhoto} without. Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
