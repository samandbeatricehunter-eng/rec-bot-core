// Upload a fully validated local legend-headshot set to Cloudflare Images, then overwrite
// the shared catalog and any materialized legend players in active leagues.
//
// Run:
//   pnpm --filter @rec/api exec tsx scripts/legend-photo-backfill.ts \
//     --images <folder> --manifest <licenses.csv>
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { env } from "../src/config/env.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const REST_URL = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return resolve(process.argv[index + 1]);
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows[0] ?? [];
  return rows.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function headers(extra: Record<string, string> = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}

function imageId(name: string): string {
  return `legend-${name.normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

async function checkedJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function upload(path: string, name: string): Promise<string> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const hash = env.CLOUDFLARE_ACCOUNT_HASH?.trim();
  if (!accountId || !token || !hash) throw new Error("Cloudflare Images environment is incomplete.");
  const id = imageId(name);
  // The user explicitly requested replacement of existing legend photos.
  const deleted = await fetch(`${CF_API}/accounts/${accountId}/images/v1/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!deleted.ok && deleted.status !== 404) throw new Error(`Cloudflare delete ${id}: HTTP ${deleted.status}`);
  const bytes = readFileSync(path);
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/png" }), basename(path));
  form.set("id", id);
  form.set("requireSignedURLs", "false");
  form.set("metadata", JSON.stringify({ collection: "rec-legends", playerName: name, rightsManifest: "licenses.csv" }));
  const payload = await checkedJson<{ success?: boolean; errors?: Array<{ message?: string }> }>(`${CF_API}/accounts/${accountId}/images/v1`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!payload.success) throw new Error(`Cloudflare upload ${id}: ${payload.errors?.[0]?.message ?? "unknown error"}`);
  return `https://imagedelivery.net/${hash}/${id}/public`;
}

async function patch(table: string, query: URLSearchParams, body: Record<string, unknown>) {
  await checkedJson(`${REST_URL}/${table}?${query}`, { method: "PATCH", headers: headers({ Prefer: "return=minimal" }), body: JSON.stringify(body) });
}

async function main() {
  const images = arg("--images");
  const manifest = arg("--manifest");
  const rows = parseCsv(readFileSync(manifest, "utf8"));
  if (rows.length !== 363) throw new Error(`Refusing upload: expected 363 manifest rows, found ${rows.length}.`);
  const invalid = rows.filter((r) => r.rights_status === "missing_placeholder" || !existsSync(join(images, r.filename)));
  if (invalid.length) throw new Error(`Refusing upload: ${invalid.length} players lack a real local image (${invalid.slice(0, 8).map((r) => r.name).join(", ")}).`);

  const catalog = await checkedJson<Array<{ id: string; name: string; position: string }>>(`${REST_URL}/rec_legend_catalog?select=id,name,position`, { headers: headers() });
  const byKey = new Map(catalog.map((r) => [`${r.name}\u0000${r.position}`, r]));
  const missingCatalog = rows.filter((r) => !byKey.has(`${r.name}\u0000${r.position}`));
  if (missingCatalog.length) throw new Error(`Refusing upload: ${missingCatalog.length} manifest players do not match the catalog.`);

  const urls = new Map<string, string>();
  let completed = 0;
  for (const row of rows) {
    const hosted = await upload(join(images, row.filename), row.name);
    const catalogRow = byKey.get(`${row.name}\u0000${row.position}`)!;
    await patch("rec_legend_catalog", new URLSearchParams({ id: `eq.${catalogRow.id}` }), { photo_url: hosted });
    urls.set(catalogRow.id, hosted);
    completed++;
    if (completed % 25 === 0 || completed === rows.length) console.log(`uploaded/catalog-updated ${completed}/${rows.length}`);
  }

  // The application defines active leagues as leagues with at least one live team assignment.
  const assignments = await checkedJson<Array<{ league_id: string }>>(`${REST_URL}/rec_team_assignments?select=league_id&assignment_status=eq.active&ended_at=is.null`, { headers: headers() });
  const activeLeagueIds = [...new Set(assignments.map((r) => r.league_id))];
  let playersUpdated = 0;
  for (const leagueId of activeLeagueIds) {
    const players = await checkedJson<Array<{ id: string; raw_payload: { legendId?: string } | null }>>(
      `${REST_URL}/rec_players?select=id,raw_payload&league_id=eq.${encodeURIComponent(leagueId)}&player_source=eq.legend`, { headers: headers() },
    );
    for (const player of players) {
      const legendId = player.raw_payload?.legendId;
      const hosted = legendId ? urls.get(legendId) : null;
      if (!hosted) continue;
      await patch("rec_players", new URLSearchParams({ id: `eq.${player.id}` }), { photo_url: hosted });
      playersUpdated++;
    }
  }
  console.log(JSON.stringify({ catalogUpdated: completed, activeLeagues: activeLeagueIds.length, activeLeagueLegendPlayersUpdated: playersUpdated }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
