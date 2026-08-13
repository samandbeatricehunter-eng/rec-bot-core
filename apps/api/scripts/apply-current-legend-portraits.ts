import { readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import sharp from "sharp";
import { env } from "../src/config/env.js";

const folder = resolve(process.argv[process.argv.indexOf("--images") + 1] ?? "");
const CF_API = "https://api.cloudflare.com/client/v4";
const REST_URL = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const normalize = (value: string) => value.normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const aliases: Record<string, string> = {
  darellerevis: "darrellerevis",
  edtootalljones: "edtootalljones",
  williamperry: "williamrefrigeratorperry",
  dreed: "edreed",
  imkelly: "jimkelly",
  adamvinatier: "adamvinatieri",
};
const imageId = (name: string) => `legend-${normalize(name)}`;

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${response.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function upload(path: string, name: string): Promise<string> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const hash = env.CLOUDFLARE_ACCOUNT_HASH?.trim();
  if (!accountId || !token || !hash) throw new Error("Cloudflare Images environment is incomplete.");
  const id = imageId(name);
  const deleted = await fetch(`${CF_API}/accounts/${accountId}/images/v1/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!deleted.ok && deleted.status !== 404) throw new Error(`Cloudflare delete ${id}: ${deleted.status}`);
  const bytes = await sharp(path)
    .rotate()
    .resize(1024, 1024, { fit: "cover", position: "attention" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/png" }), `${basename(path, extname(path))}.png`);
  form.set("id", id);
  form.set("requireSignedURLs", "false");
  form.set("metadata", JSON.stringify({ collection: "rec-legends", playerName: name, source: "user-provided-legend-portraits" }));
  const result = await json<{ success: boolean; errors?: Array<{ message?: string }> }>(`${CF_API}/accounts/${accountId}/images/v1`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!result.success) throw new Error(result.errors?.[0]?.message ?? `Upload failed for ${name}`);
  return `https://imagedelivery.net/${hash}/${id}/public`;
}

async function patch(table: string, query: string, body: object) {
  await json(`${REST_URL}/${table}?${query}`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
}

const catalog = await json<Array<{ id: string; name: string; position: string }>>(
  `${REST_URL}/rec_legend_catalog?select=id,name,position&order=position,name`, { headers },
);
const rowsByName = new Map<string, typeof catalog>();
for (const row of catalog) {
  const key = normalize(row.name);
  rowsByName.set(key, [...(rowsByName.get(key) ?? []), row]);
}

const supported = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const files = readdirSync(folder, { withFileTypes: true })
  .filter((entry) => entry.isFile() && supported.has(extname(entry.name).toLowerCase()))
  .map((entry) => ({ name: entry.name, path: join(folder, entry.name) }));
const matched = new Map<string, { path: string; rows: typeof catalog }>();
const ignored: string[] = [];
for (const file of files) {
  const raw = normalize(basename(file.name, extname(file.name)));
  const key = aliases[raw] ?? raw;
  const rows = rowsByName.get(key);
  if (!rows?.length) { ignored.push(file.name); continue; }
  if (matched.has(key)) throw new Error(`Multiple portrait files match ${rows[0].name}`);
  matched.set(key, { path: file.path, rows });
}

const urlsByLegendId = new Map<string, string>();
let completed = 0;
for (const { path, rows } of matched.values()) {
  const url = await upload(path, rows[0].name);
  for (const row of rows) {
    await patch("rec_legend_catalog", `id=eq.${encodeURIComponent(row.id)}`, { photo_url: url });
    urlsByLegendId.set(row.id, url);
  }
  completed++;
  if (completed % 20 === 0 || completed === matched.size) console.log(`Applied ${completed}/${matched.size} portraits`);
}

const assignments = await json<Array<{ league_id: string }>>(
  `${REST_URL}/rec_team_assignments?select=league_id&assignment_status=eq.active&ended_at=is.null`, { headers },
);
const leagueIds = [...new Set(assignments.map((row) => row.league_id))];
let materializedUpdated = 0;
for (const leagueId of leagueIds) {
  const players = await json<Array<{ id: string; raw_payload: { legendId?: string } | null }>>(
    `${REST_URL}/rec_players?select=id,raw_payload&league_id=eq.${encodeURIComponent(leagueId)}&player_source=eq.legend`, { headers },
  );
  for (const player of players) {
    const url = player.raw_payload?.legendId ? urlsByLegendId.get(player.raw_payload.legendId) : undefined;
    if (!url) continue;
    await patch("rec_players", `id=eq.${encodeURIComponent(player.id)}`, { photo_url: url });
    materializedUpdated++;
  }
}

const missing = [...rowsByName.entries()]
  .filter(([key]) => !matched.has(key))
  .flatMap(([, rows]) => rows)
  .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
const grouped = new Map<string, string[]>();
for (const row of missing) grouped.set(row.position, [...(grouped.get(row.position) ?? []), row.name]);
const markdown = [
  "# Legends missing updated headshots",
  "",
  `Current catalog rows: ${catalog.length}`,
  `Portrait identities applied: ${matched.size}`,
  `Catalog rows still missing a supplied updated portrait: ${missing.length}`,
  "",
  ...[...grouped].flatMap(([position, names]) => [`## ${position} (${names.length})`, "", ...names.map((name) => `- ${name}`), ""]),
].join("\n");
const reportPath = resolve(process.cwd(), "../../docs/legends/missing-updated-headshots.md");
writeFileSync(reportPath, markdown);
console.log(JSON.stringify({ files: files.length, appliedIdentities: matched.size, appliedCatalogRows: urlsByLegendId.size, ignoredFiles: ignored.length, missingRows: missing.length, materializedUpdated, reportPath, ignored }, null, 2));
