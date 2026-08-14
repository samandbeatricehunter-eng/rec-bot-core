// One-time (and re-runnable) upload of the 150 custom-player card renders to Cloudflare
// Images, so they stop shipping inside every site deploy (~348 MB of PNGs).
//
// Each PNG in apps/web/public/assets/custom-player-renders/cpr-XXX.png is converted to WebP
// (sharp, ~60–90 MB total) and uploaded with a stable custom image id equal to the render id
// (cpr-001 … cpr-150). That makes the delivery URL deterministic:
//   https://imagedelivery.net/<account-hash>/cpr-XXX/public
// which is exactly what packages/shared/src/custom-player-renders.ts builds when it detects
// an imagedelivery.net base — so after uploading you only need to set:
//   site:  VITE_ASSET_BASE_URL=https://imagedelivery.net/<account-hash>
//   api:   CUSTOM_PLAYER_RENDER_BASE_URL=https://imagedelivery.net/<account-hash>
// (both with no trailing slash).
//
// Re-running is safe: a duplicate custom id is deleted and re-uploaded (replace semantics),
// matching legend-photo-backfill.ts. Local PNGs are never modified or deleted.
//
// Run:
//   pnpm --filter @rec/api exec tsx scripts/upload-custom-player-renders.ts
//   pnpm --filter @rec/api exec tsx scripts/upload-custom-player-renders.ts --dir <folder> --dry-run
//
// Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_HASH in .env.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { env } from "../src/config/env.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const DEFAULT_DIR = resolve(process.cwd(), "../web/public/assets/custom-player-renders");
const MANIFEST_PATH = resolve(process.cwd(), "scripts/.custom-player-renders-upload.json");
const WEBP_QUALITY = 82;

function opt(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : null;
}
const hasFlag = (name: string) => process.argv.includes(name);

function requireConfig() {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const hash = env.CLOUDFLARE_ACCOUNT_HASH?.trim();
  if (!accountId || !token || !hash) {
    throw new Error("Cloudflare Images environment is incomplete (need CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_HASH).");
  }
  return { accountId, token, hash };
}

async function uploadOne(cfg: ReturnType<typeof requireConfig>, id: string, webp: Buffer): Promise<string> {
  // Replace semantics: a custom id that already exists is rejected by Cloudflare, so delete
  // first (404 is fine) then upload fresh.
  const deleted = await fetch(`${CF_API}/accounts/${cfg.accountId}/images/v1/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!deleted.ok && deleted.status !== 404) {
    throw new Error(`Cloudflare delete ${id}: HTTP ${deleted.status}`);
  }
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(webp)], { type: "image/webp" }), `${id}.webp`);
  form.set("id", id);
  form.set("requireSignedURLs", "false");
  form.set("metadata", JSON.stringify({ collection: "rec-custom-player-renders", renderId: id }));
  const response = await fetch(`${CF_API}/accounts/${cfg.accountId}/images/v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json().catch(() => null)) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || !payload?.success) {
    throw new Error(`Cloudflare upload ${id}: ${payload?.errors?.[0]?.message ?? `HTTP ${response.status}`}`);
  }
  return `https://imagedelivery.net/${cfg.hash}/${id}/public`;
}

async function main() {
  const dir = opt("--dir") ?? DEFAULT_DIR;
  const dryRun = hasFlag("--dry-run");
  if (!existsSync(dir)) throw new Error(`Render folder not found: ${dir}`);

  const files = readdirSync(dir)
    .filter((name) => /^cpr-\d{3}\.png$/i.test(name))
    .sort();
  if (files.length !== 150) {
    throw new Error(`Refusing upload: expected 150 cpr-XXX.png files in ${dir}, found ${files.length}.`);
  }

  const cfg = dryRun ? null : requireConfig();
  const manifest: Record<string, string> = {};
  let completed = 0;
  let sourceBytes = 0;
  let webpBytes = 0;

  for (const name of files) {
    const id = name.replace(/\.png$/i, "");
    const sourcePath = join(dir, name);
    const webp = await sharp(sourcePath).webp({ quality: WEBP_QUALITY }).toBuffer();
    sourceBytes += (await sharp(sourcePath).metadata().then((m) => m.size ?? 0).catch(() => 0)) || 0;
    webpBytes += webp.byteLength;

    if (dryRun) {
      manifest[id] = `https://imagedelivery.net/<account-hash>/${id}/public`;
    } else {
      manifest[id] = await uploadOne(cfg!, id, webp);
    }
    completed++;
    if (completed % 25 === 0 || completed === files.length) {
      console.log(`${dryRun ? "would upload" : "uploaded"} ${completed}/${files.length}`);
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: files.length, webpQuality: WEBP_QUALITY, urls: manifest }, null, 2));
  console.log(JSON.stringify({
    dryRun,
    uploaded: dryRun ? 0 : completed,
    count: files.length,
    webpMB: Math.round((webpBytes / 1024 / 1024) * 10) / 10,
    manifest: MANIFEST_PATH,
    deliveryBase: cfg ? `https://imagedelivery.net/${cfg.hash}` : "https://imagedelivery.net/<account-hash>",
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
