// Re-runnable RTI headshot catalog upload. Converts source PNGs to WebP and replaces
// deterministic Cloudflare Images IDs used by packages/shared's picker catalog.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { env } from "../src/config/env.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const dryRun = process.argv.includes("--dry-run");
const groups = [
  { dir: resolve(process.cwd(), "../Owner Headshots"), prefix: "owner", expected: 33 },
  { dir: resolve(process.cwd(), "../generic player headshots/new QB headshots"), prefix: "qb", expected: 20 },
  { dir: resolve(process.cwd(), "../generic player headshots/new MIKE headshots"), prefix: "mike", expected: 20 },
] as const;

function config() {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const hash = env.CLOUDFLARE_ACCOUNT_HASH?.trim();
  if (!accountId || !token || !hash) throw new Error("Cloudflare Images config is incomplete.");
  return { accountId, token, hash };
}

async function upload(cfg: ReturnType<typeof config>, id: string, bytes: Buffer) {
  const deleted = await fetch(`${CF_API}/accounts/${cfg.accountId}/images/v1/${id}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!deleted.ok && deleted.status !== 404) throw new Error(`Delete ${id}: HTTP ${deleted.status}`);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/webp" }), `${id}.webp`);
  form.set("id", id);
  form.set("requireSignedURLs", "false");
  form.set("metadata", JSON.stringify({ collection: "rec-rti-headshots", catalogId: id }));
  const response = await fetch(`${CF_API}/accounts/${cfg.accountId}/images/v1`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.token}` }, body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || !body?.success) throw new Error(`Upload ${id}: ${body?.errors?.[0]?.message ?? response.status}`);
}

async function main() {
  const cfg = dryRun ? null : config();
  let completed = 0;
  for (const group of groups) {
    if (!existsSync(group.dir)) throw new Error(`Headshot folder not found: ${group.dir}`);
    const files = readdirSync(group.dir).filter((name) => /\.png$/i.test(name)).sort();
    if (files.length !== group.expected) throw new Error(`Expected ${group.expected} ${group.prefix} PNGs; found ${files.length}.`);
    for (let index = 0; index < files.length; index++) {
      const id = `rti-${group.prefix}-headshot-${String(index + 1).padStart(3, "0")}`;
      const bytes = await sharp(join(group.dir, files[index]!)).resize(640, 640, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
      if (cfg) await upload(cfg, id, bytes);
      completed += 1;
      if (completed % 10 === 0 || completed === 73) console.log(`${dryRun ? "validated" : "uploaded"} ${completed}/73`);
    }
  }
  console.log(JSON.stringify({ dryRun, count: completed, deliveryBase: cfg ? `https://imagedelivery.net/${cfg.hash}` : null }));
}

main().catch((error) => { console.error(error); process.exit(1); });
