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
const GAME_TITLE = "madden_27";
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

let cloudflareWarned = false;
async function rehostPhoto(sourceUrl: string, slug: string): Promise<string> {
  if (!sourceUrl) return "";
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    if (!cloudflareWarned) {
      console.warn("CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set — storing source-site photo URLs directly.");
      console.warn("Re-run this script after Cloudflare Images is configured to backfill real hosted URLs.");
      cloudflareWarned = true;
    }
    return sourceUrl;
  }
  try {
    const form = new FormData();
    form.set("url", sourceUrl);
    form.set("id", `madden27-${slug}`);
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
    });
    const body = (await res.json()) as { success: boolean; result?: { variants?: string[] }; errors?: Array<{ message: string }> };
    if (!body.success || !body.result?.variants?.length) {
      console.warn(`  Cloudflare Images upload failed for ${slug}: ${body.errors?.map((e) => e.message).join("; ") ?? "unknown error"}`);
      return sourceUrl;
    }
    return body.result.variants[0];
  } catch (err) {
    console.warn(`  Cloudflare Images upload threw for ${slug}:`, err);
    return sourceUrl;
  }
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
      name: row.name,
      team_abbreviation: row.team === "Free Agent" ? null : row.team,
      position: row.position,
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
      photo_url: row.url, // placeholder — Cloudflare re-host pass below overwrites per-row
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
  for (const row of stubRows) {
    const slug = slugFromUrl(row.url);
    const hasRatings = row.dataSource?.startsWith("Madden NFL 26");
    rows.push({
      dataset_id: datasetId,
      source_slug: slug,
      name: row.name,
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
      total_attributes: null,
    });
  }

  console.log(`Re-hosting ${rows.length} photos${env.CLOUDFLARE_ACCOUNT_ID ? " via Cloudflare Images" : " (Cloudflare not configured — using source URLs)"}...`);
  let photosDone = 0;
  const CONCURRENCY = 8;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        row.photo_url = await rehostPhoto(String(row.photo_url ?? ""), String(row.source_slug));
        photosDone++;
        if (photosDone % 200 === 0) console.log(`  photos: ${photosDone}/${rows.length}`);
      }
    }),
  );

  console.log(`Inserting ${rows.length} baseline players...`);
  await insertBatched("rec_madden_baseline_players", rows);

  console.log("Done. Dataset:", datasetId, "| players:", rows.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
