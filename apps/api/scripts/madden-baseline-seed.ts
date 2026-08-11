// Madden 27 baseline roster seed — see docs/madden-fantasy-draft-plan.md §1-2, §10.
//
// Reads the three committed CSVs (apps/api/scripts/data/madden27/*.csv — scraped from
// maddenratings.com, real-life-cross-referenced against NFL.com for the unrated stub
// players, see the plan doc for full provenance) and populates:
//   rec_madden_roster_datasets      (one approved, active, versioned dataset)
//   rec_madden_baseline_players     (every player, flat attribute columns)
//
// Idempotent — re-running wipes any existing dataset with the same (game_title, provider,
// published_date, source_version) identity and re-seeds, same pattern as
// cfb-baseline-seed.ts.
//
// Photo re-hosting: if CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN are set, downloads each
// player's photo from the source CSV's `image`/`photo_url` column and uploads it to
// Cloudflare Images, storing the Cloudflare-hosted URL instead of the source site's URL
// (never serve maddenratings.com URLs to end users — see plan doc §8). If Cloudflare isn't
// configured, falls back to storing the source URL directly with a warning, so this script
// stays runnable before that's wired up — re-run later once Cloudflare Images is confirmed
// provisioned to backfill real hosted URLs.
//
// Run: pnpm --filter @rec/api exec tsx scripts/madden-baseline-seed.ts
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";
import { deliveryUrl } from "../src/lib/cloudflare-images.js";

// Plain PostgREST calls instead of @supabase/supabase-js — that package's createClient()
// unconditionally instantiates a realtime client, which throws on Node <22 (no native
// WebSocket) even though this script never touches realtime. Avoids the whole dependency
// for a script that's pure insert/delete anyway.
const REST_URL = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
type RestResult<T> = { data: T | null; error: { message: string } | null };
async function restSelect<T>(table: string, query: string): Promise<RestResult<T>> {
  const res = await fetch(`${REST_URL}/${table}?${query}`, { headers: restHeaders() });
  if (!res.ok) return { data: null, error: { message: `${res.status} ${await res.text()}` } };
  return { data: (await res.json()) as T, error: null };
}
async function restInsert<T>(table: string, rows: unknown, opts: { select?: boolean; single?: boolean } = {}): Promise<RestResult<T>> {
  const res = await fetch(`${REST_URL}/${table}`, {
    method: "POST",
    headers: restHeaders({ Prefer: opts.select ? `return=representation${opts.single ? ",resolution=merge-duplicates" : ""}` : "return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) return { data: null, error: { message: `${res.status} ${await res.text()}` } };
  const data = opts.select ? ((await res.json()) as T) : null;
  return { data, error: null };
}
async function restDelete(table: string, query: string): Promise<RestResult<null>> {
  const res = await fetch(`${REST_URL}/${table}?${query}`, { method: "DELETE", headers: restHeaders() });
  if (!res.ok) return { data: null, error: { message: `${res.status} ${await res.text()}` } };
  return { data: null, error: null };
}
async function restUpdate(table: string, query: string, patch: unknown): Promise<RestResult<null>> {
  const res = await fetch(`${REST_URL}/${table}?${query}`, { method: "PATCH", headers: restHeaders(), body: JSON.stringify(patch) });
  if (!res.ok) return { data: null, error: { message: `${res.status} ${await res.text()}` } };
  return { data: null, error: null };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const M26_DIR = join(__dirname, "data", "madden26");
const GAME_TITLE = "madden_27";
const POSITION_CORRECTIONS: Record<string, string> = {
  // The source free-agent CSV omits his position; EA lists Amadi as a cornerback.
  "ugo-amadi": "CB",
};
const PROVIDER = "maddenratings.com";
const SOURCE_VERSION = "2026-08-07";

// CSV header -> DB column. Same order as the migration's flat attribute columns.
const ATTRIBUTE_COLUMNS: Record<string, string> = {
  Speed: "speed", Acceleration: "acceleration", Strength: "strength", Agility: "agility", Awareness: "awareness",
  Jumping: "jumping", Injury: "injury", Stamina: "stamina", Toughness: "toughness",
  "Throw Power": "throw_power", "Throw Under Pressure": "throw_under_pressure", "Throw Accuracy Short": "throw_accuracy_short",
  "Throw Accuracy Mid": "throw_accuracy_mid", "Throw Accuracy Deep": "throw_accuracy_deep", "Throw on the Run": "throw_on_the_run", "Play Action": "play_action",
  Catching: "catching", "Spectacular Catch": "spectacular_catch", "Catch in Traffic": "catch_in_traffic",
  "Route Running Short": "route_running_short", "Route Running Medium": "route_running_medium", "Route Running Deep": "route_running_deep", Release: "release",
  Carrying: "carrying", "Break Tackle": "break_tackle", Trucking: "trucking", "Change of Direction": "change_of_direction",
  "BC Vision": "bc_vision", "Stiff Arm": "stiff_arm", "Spin Move": "spin_move", "Juke Move": "juke_move", "Break Sack": "break_sack",
  Tackle: "tackle", "Power Moves": "power_moves", "Finesse Moves": "finesse_moves", "Block Shedding": "block_shedding", Pursuit: "pursuit",
  "Play Recognition": "play_recognition", "Man Coverage": "man_coverage", "Zone Coverage": "zone_coverage", "Hit Power": "hit_power", Press: "press",
  "Run Block": "run_block", "Pass Block": "pass_block", "Impact Blocking": "impact_blocking", "Run Block Power": "run_block_power",
  "Run Block Finesse": "run_block_finesse", "Pass Block Power": "pass_block_power", "Pass Block Finesse": "pass_block_finesse", "Lead Block": "lead_block",
  "Kick Power": "kick_power", "Kick Accuracy": "kick_accuracy", "Kick Return": "kick_return",
};

type Row = Record<string, string>;

// Madden 26 CSV header -> madden_27 baseline DB column. Used to backfill the unrated stub
// players (plan doc §1/§12) from the per-team M26 rating CSVs in data/madden26/. M26 has no
// injury/kicking columns; those stay null on backfilled rows.
const M26_ATTRIBUTE_MAP: Record<string, string> = {
  Speed: "speed", Acceleration: "acceleration", Agility: "agility", Awareness: "awareness", Strength: "strength",
  Stamina: "stamina", Jumping: "jumping", Toughness: "toughness", "Change of Direction": "change_of_direction",
  "Throw Power": "throw_power", "Short Accuracy": "throw_accuracy_short", "Mid Accuracy": "throw_accuracy_mid",
  "Deep Accuracy": "throw_accuracy_deep", "Throw on Run": "throw_on_the_run", "Throw Under Pressure": "throw_under_pressure",
  "Play Action": "play_action", "Break Sack": "break_sack", Catching: "catching", "Catch in Traffic": "catch_in_traffic",
  "Spectacular Catch": "spectacular_catch", "Short Routes": "route_running_short", "Mid Routes": "route_running_medium",
  "Deep Routes": "route_running_deep", Release: "release", Carrying: "carrying", "Ball Carrier Vision": "bc_vision",
  Trucking: "trucking", "Stiff Arm": "stiff_arm", "Spin Move": "spin_move", "Juke Move": "juke_move",
  "Break Tackle": "break_tackle", "Run Blocking": "run_block", "Pass Blocking": "pass_block",
  "Impact Blocking": "impact_blocking", "Lead Block": "lead_block", "Run Block Finesse": "run_block_finesse",
  "Run Block Power": "run_block_power", "Pass Block Finesse": "pass_block_finesse", "Pass Block Power": "pass_block_power",
  "Finesse Moves": "finesse_moves", "Power Moves": "power_moves", "Block Shedding": "block_shedding", Tackle: "tackle",
  "Hit Power": "hit_power", Pursuit: "pursuit", "Play Recognition": "play_recognition", "Man Coverage": "man_coverage",
  "Zone Coverage": "zone_coverage", Press: "press",
};

function decodeEntities(s: string): string {
  return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function normalizeName(name: string): string {
  return decodeEntities(name).toLowerCase().replace(/\./g, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
}

function stripSuffix(name: string): string {
  return name.replace(/\s+(jr|sr|ii|iii|iv)$/i, "");
}

function slugName(url: string): string {
  const slug = slugFromUrl(url);
  return slug.split("-").filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

/** Build a normalized-name -> M26 row lookup, with suffix-stripped variants as fallback. */
function loadM26Lookup(): Map<string, Row> {
  const lookup = new Map<string, Row>();
  for (const file of ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"]) {
    const path = join(M26_DIR, `madden-ratings-${file}.csv`);
    if (!existsSync(path)) continue;
    for (const row of parseCsv(readFileSync(path, "utf8"))) {
      const n = normalizeName(row.Player);
      if (!n) continue;
      if (!lookup.has(n)) lookup.set(n, row);
      const ns = normalizeName(stripSuffix(row.Player));
      if (ns && ns !== n && !lookup.has(ns)) lookup.set(ns, row);
    }
  }
  return lookup;
}

function parseCsv(text: string): Row[] {
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

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function checksumOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T extends { error: { message: string } | null }>(run: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await run();
    if (!res.error) return res;
    lastError = res.error.message;
    console.warn(`  ${label} failed (attempt ${attempt}/${attempts}): ${lastError}`);
    if (attempt < attempts) await sleep(3000 * attempt);
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError}`);
}

async function clearDataset(datasetId: string): Promise<void> {
  await withRetry(() => restDelete("rec_madden_baseline_players", `dataset_id=eq.${datasetId}`), "clear baseline players");
  await withRetry(() => restDelete("rec_madden_roster_datasets", `id=eq.${datasetId}`), "clear dataset");
}

// Photo re-host: download each photo from the source site and upload the binary to
// Cloudflare Images (Cloudflare's own URL-fetch is unreliable against maddenratings.com and
// not idempotent — duplicate custom IDs error instead of replacing). Stable id
// `madden27-<slug>` lets re-seeds replace images; on an "already exists" error we delete
// and retry. Delivery URL is built from CLOUDFLARE_ACCOUNT_HASH when set (never serve the
// source-site URL to end users — see plan doc §8). Returns "" if a photo is absent or the
// upload ultimately fails; callers store "" (silhouette placeholder) rather than a dead
// source URL.
const CF_IMAGES_API = "https://api.cloudflare.com/client/v4";

// maddenratings.com blocks plain-fetch image downloads (hotlink protection) — browser-ish
// headers make the download succeed.
const IMAGE_DOWNLOAD_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.maddenratings.com/",
};

/**
 * Photos are permanently hosted on Cloudflare Images under a stable custom id
 * `madden27-<slug>`, so the delivery URL is deterministic and idempotent:
 *   https://imagedelivery.net/<hash>/madden27-<slug>/public
 * Existing images therefore never need re-uploading — a cheap HEAD against the delivery
 * URL confirms the photo is already permanently hosted and we just record the URL. This is
 * what makes re-seeds fast and avoids Cloudflare's re-upload rate limits entirely.
 */
async function imageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Photo re-host: download each photo from the source site and upload the binary to
// Cloudflare Images (Cloudflare's own URL-fetch is unreliable against maddenratings.com and
// not idempotent — duplicate custom IDs error instead of replacing). Stable id
// `madden27-<slug>` lets re-seeds replace images; on an "already exists" error we delete
// and retry. Delivery URL is built from CLOUDFLARE_ACCOUNT_HASH when set (never serve the
// source-site URL to end users — see plan doc §8). Returns "" if a photo is absent or the
// upload ultimately fails; callers store "" (silhouette placeholder) rather than a dead
// source URL.
async function rehostPhoto(sourceUrl: string, slug: string, accountId: string, apiToken: string, accountHash: string): Promise<string> {
  if (!sourceUrl) return "";

  async function download(): Promise<{ ok: boolean; buffer?: ArrayBuffer; contentType?: string; status: number }> {
    try {
      const res = await fetch(sourceUrl, { headers: IMAGE_DOWNLOAD_HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, buffer: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/png", status: res.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  async function upload(): Promise<{ ok: boolean; payload: { success?: boolean; result?: { variants?: string[] }; errors?: Array<{ message?: string }> } | null }> {
    const dl = await download();
    if (!dl.ok || !dl.buffer) return { ok: false, payload: { errors: [{ message: `download failed (HTTP ${dl.status})` }] } };
    const form = new FormData();
    form.set("file", new Blob([dl.buffer], { type: dl.contentType }), `${slug}.png`);
    form.set("id", `madden27-${slug}`);
    form.set("requireSignedURLs", "false");
    try {
      const res = await fetch(`${CF_IMAGES_API}/accounts/${accountId}/images/v1`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await res.json().catch(() => null) as { success?: boolean; result?: { variants?: string[] }; errors?: Array<{ message?: string }> } | null;
      return { ok: res.ok && !!payload?.success && !!payload.result?.variants?.length, payload };
    } catch (err) {
      return { ok: false, payload: { errors: [{ message: String(err) }] } };
    }
  }

  async function attempt(): Promise<string> {
    const { ok, payload } = await upload();
    if (!ok) return "";
    return accountHash ? deliveryUrl(accountHash, `madden27-${slug}`) : payload?.result?.variants?.[0] ?? "";
  }

  let url = await attempt();
  if (!url) {
    // Cloudflare rejects re-uploads to an existing custom ID — delete and retry once.
    await fetch(`${CF_IMAGES_API}/accounts/${accountId}/images/v1/madden27-${slug}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    }).catch(() => {});
    url = await attempt();
  }
  return url;
}

async function insertBatched(table: string, rows: Array<Record<string, unknown>>, batchSize = 250): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    await withRetry(() => restInsert(table, chunk), `insert ${table} [${i}-${i + chunk.length}]`);
    inserted += chunk.length;
    console.log(`  inserted ${inserted}/${rows.length} into ${table}`);
  }
  return inserted;
}

async function main() {
  const rostersPath = join(DATA_DIR, "madden27_all_rosters.csv");
  const faPath = join(DATA_DIR, "madden27_free_agents.csv");
  const stubsPath = join(DATA_DIR, "madden27_unrated_players_final.csv");
  for (const p of [rostersPath, faPath, stubsPath]) {
    if (!existsSync(p)) throw new Error(`Missing seed CSV: ${p}`);
  }

  const rosterRows = parseCsv(readFileSync(rostersPath, "utf8"));
  const faRows = parseCsv(readFileSync(faPath, "utf8"));
  const stubRows = parseCsv(readFileSync(stubsPath, "utf8"));
  console.log(`Loaded ${rosterRows.length} rostered + ${faRows.length} free agent + ${stubRows.length} placeholder players.`);

  // team display name -> abbreviation isn't in our CSVs directly for rated players (they
  // carry the full team name, e.g. "Buffalo Bills") — @rec/shared's AFC_TEAMS/NFC_TEAMS
  // catalog (used by team-ownership.service.ts to seed rec_teams) is the join target at
  // apply-to-league time, matched there by full name, not here. This seed script stores
  // team_abbreviation as the plain team name string for now (rename field usage TBD when
  // wiring applyMaddenBaselineToLeague — see plan doc §3) since @rec/shared's team catalog
  // shape wasn't re-verified in this pass; whichever of name/abbreviation
  // applyMaddenBaselineToLeague ends up matching on, keep this script's output consistent
  // with it.
  void checksumOf; // reserved for a future source_records audit table, not used yet

  const existing = await restSelect<Array<{ id: string }>>(
    "rec_madden_roster_datasets",
    `select=id&game_title=eq.${GAME_TITLE}&provider=eq.${PROVIDER}&source_version=eq.${SOURCE_VERSION}`,
  );
  if (existing.data?.length) {
    console.log("Existing dataset with this version found — clearing before re-seed.");
    await clearDataset(existing.data[0].id);
  }

  const dataset = await withRetry(
    () =>
      restInsert<Array<{ id: string }>>(
        "rec_madden_roster_datasets",
        { game_title: GAME_TITLE, provider: PROVIDER, published_date: SOURCE_VERSION, source_version: SOURCE_VERSION, is_active: true },
        { select: true },
      ),
    "create dataset",
  );
  const datasetId = dataset.data![0].id;
  console.log("Created dataset", datasetId);

  // Deactivate any other active dataset for this game so applyMaddenBaselineToLeague's
  // "is_active" lookup is unambiguous.
  await withRetry(
    () => restUpdate("rec_madden_roster_datasets", `game_title=eq.${GAME_TITLE}&id=neq.${datasetId}`, { is_active: false }),
    "deactivate prior datasets",
  );

  // Real photo URLs keyed by slug (see scrape-madden-photos.ts). The rosters/FA CSVs only
  // carry player *page* URLs, which are useless as photos — without this map those rows get
  // "" (silhouette placeholder).
  const photoMap = new Map<string, string>();
  const photoCsvPath = join(DATA_DIR, "madden27_player_photos.csv");
  if (existsSync(photoCsvPath)) {
    for (const row of parseCsv(readFileSync(photoCsvPath, "utf8"))) if (row.id && row.image) photoMap.set(row.id, row.image);
    console.log(`Loaded ${photoMap.size} photo URLs from madden27_player_photos.csv`);
  }

  const rows: Array<Record<string, unknown>> = [];

  function attributeColumns(row: Row): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [csvKey, dbCol] of Object.entries(ATTRIBUTE_COLUMNS)) out[dbCol] = num(row[csvKey]);
    return out;
  }

  for (const row of [...rosterRows, ...faRows]) {
    const slug = slugFromUrl(row.url);
    rows.push({
      dataset_id: datasetId,
      source_slug: slug,
      name: decodeEntities(row.name),
      team_abbreviation: row.team === "Free Agent" ? null : row.team,
      position: row.position || POSITION_CORRECTIONS[slug] || "UNKNOWN",
      position_full: row.positionFull || null,
      jersey_number: num(row.jersey),
      archetype: row.archetype || null,
      overall_rating: num(row.ovr),
      age: num(row.age),
      date_of_birth: row.dateOfBirth ? new Date(row.dateOfBirth).toISOString().slice(0, 10) : null,
      nationality: row.nationality || null,
      college: row.college || null,
      years_pro: num(row.yearsPro),
      draft_year: num(row.draftYear),
      draft_pick_overall: num(row.draftPickOverall),
      drafted_by_team: row.draftedByTeam || null,
      photo_url: photoMap.get(slug) ?? "", // placeholder — Cloudflare re-host pass below fills in
      abilities_raw: row.abilitiesRaw || null,
      data_quality: "rated",
      ...attributeColumns(row),
      total_attributes: num(row["Total Attributes"]),
    });
  }

  // PostgREST's bulk insert requires every row in a batch to share the exact same key set
  // (PGRST102 "All object keys must match") — placeholder rows must carry the same null
  // attribute columns the rated rows get from attributeColumns(), not omit them.
  const nullAttributeColumns = Object.fromEntries(Object.values(ATTRIBUTE_COLUMNS).map((col) => [col, null]));
  const m26Lookup = loadM26Lookup();
  let m26Matched = 0;
  for (const row of stubRows) {
    const slug = slugFromUrl(row.url);
    // Repair lost names (scrape artifact) from the URL slug before matching.
    if (row.name === "Madden 27 Ratings Database") row.name = slugName(row.url) || row.name;
    const m26 = m26Lookup.get(normalizeName(row.name)) ?? m26Lookup.get(normalizeName(stripSuffix(row.name)));
    const hasRatings = row.dataSource?.startsWith("Madden NFL 26") || Boolean(m26);
    const m26Columns: Record<string, unknown> = {};
    let m26AttrCount = 0;
    if (m26) {
      m26Matched++;
      for (const [m26Col, dbCol] of Object.entries(M26_ATTRIBUTE_MAP)) {
        const v = num(m26[m26Col]);
        m26Columns[dbCol] = v;
        if (v !== null) m26AttrCount++;
      }
    }
    rows.push({
      dataset_id: datasetId,
      source_slug: slug,
      name: decodeEntities(row.name),
      team_abbreviation: row.team === "Free Agent" ? null : row.team,
      position: row.position || "UNKNOWN",
      position_full: null,
      jersey_number: null,
      archetype: null,
      overall_rating: num(row.ovr),
      age: null,
      date_of_birth: null,
      nationality: row.nationality || null,
      college: row.college || null,
      years_pro: null,
      draft_year: row.draftClass ? num(row.draftClass) : null,
      draft_pick_overall: null,
      drafted_by_team: null,
      photo_url: row.image || row.url,
      abilities_raw: null,
      data_quality: hasRatings ? "backfilled_prior_year" : "placeholder",
      ...nullAttributeColumns,
      ...m26Columns,
      total_attributes: m26 ? (m26AttrCount || null) : null,
    });
  }
  if (m26Matched) console.log(`Backfilled ${m26Matched} stub players from Madden 26 rating CSVs.`);

  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  const accountHash = env.CLOUDFLARE_ACCOUNT_HASH?.trim() ?? "";
  const useCloudflare = Boolean(accountId && apiToken);
  console.log(
    `Ensuring ${rows.length} photos are permanently hosted${useCloudflare ? " via Cloudflare Images (skipping already-hosted)" : " (Cloudflare not configured — using source URLs)"}...`,
  );
  let photosDone = 0;
  let photoFailures = 0;
  let alreadyHosted = 0;
  const CONCURRENCY = 8;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        if (useCloudflare) {
          const srcUrl = String(row.photo_url ?? "");
          if (srcUrl) {
            // Photos already permanent-hosted under the stable custom id need no upload —
            // confirm via the deterministic delivery URL and record it.
            const delivery = accountHash ? deliveryUrl(accountHash, `madden27-${row.source_slug}`) : "";
            if (delivery && (await imageExists(delivery))) {
              alreadyHosted++;
              row.photo_url = delivery;
            } else {
              const hosted = await rehostPhoto(srcUrl, String(row.source_slug), accountId, apiToken, accountHash);
              if (!hosted) photoFailures++;
              row.photo_url = hosted;
            }
          }
          // rows with no photo source keep "" (silhouette placeholder)
        }
        photosDone++;
        if (photosDone % 200 === 0) console.log(`  photos: ${photosDone}/${rows.length} (${alreadyHosted} already hosted, ${photoFailures} failed)`);
      }
    }),
  );
  console.log(`Photo pass done: ${photosDone} processed, ${alreadyHosted} already hosted, ${photoFailures} with no hosted URL${useCloudflare ? "" : " (falling back to source URLs)"}.`);

  console.log(`Inserting ${rows.length} baseline players...`);
  await insertBatched("rec_madden_baseline_players", rows);

  console.log("Done. Dataset:", datasetId, "| players:", rows.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
