// Re-runnable upload for the RTI tweet-feed avatar catalog: the 4 named host personas
// (tweet-bank.ts's TWEET_HOSTS) and a pool of generic account headshots used by the new
// curated 50-account catalog (media companies, analyst-archetypes, fan/hater accounts).
// Mirrors upload-rti-headshots.ts's convention -- deterministic Cloudflare Images IDs so
// re-running this script (e.g. swapping a photo later) updates the same URL in place.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { env } from "../src/config/env.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const dryRun = process.argv.includes("--dry-run");

const hosts = [
  { file: "Marcus Vale.png", id: "rti-tweet-host-marcus" },
  { file: "Jalen Cross.png", id: "rti-tweet-host-jalen" },
  { file: "Elliott Mercer.png", id: "rti-tweet-host-elliot" },
  { file: "Darius King.png", id: "rti-tweet-host-darius" },
] as const;

const genericDir = resolve(process.cwd(), "../generic twitter headshots");
const hostDir = resolve(process.cwd(), "..");

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
  form.set("metadata", JSON.stringify({ collection: "rec-rti-tweet-avatars", catalogId: id }));
  const response = await fetch(`${CF_API}/accounts/${cfg.accountId}/images/v1`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.token}` }, body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || !body?.success) throw new Error(`Upload ${id}: ${body?.errors?.[0]?.message ?? response.status}`);
}

async function main() {
  const cfg = dryRun ? null : config();
  const results: Array<{ id: string; source: string }> = [];

  for (const host of hosts) {
    const path = join(hostDir, host.file);
    if (!existsSync(path)) throw new Error(`Host headshot not found: ${path}`);
    const bytes = await sharp(path).resize(400, 400, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
    if (cfg) await upload(cfg, host.id, bytes);
    results.push({ id: host.id, source: host.file });
  }

  if (!existsSync(genericDir)) throw new Error(`Generic headshot folder not found: ${genericDir}`);
  const genericFiles = readdirSync(genericDir).filter((name) => /\.png$/i.test(name)).sort();
  for (let index = 0; index < genericFiles.length; index++) {
    const id = `rti-tweet-generic-${String(index + 1).padStart(3, "0")}`;
    const bytes = await sharp(join(genericDir, genericFiles[index]!)).resize(400, 400, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
    if (cfg) await upload(cfg, id, bytes);
    results.push({ id, source: genericFiles[index]! });
  }

  const deliveryBase = cfg ? `https://imagedelivery.net/${cfg.hash}` : null;
  console.log(JSON.stringify({ dryRun, count: results.length, deliveryBase, results }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
