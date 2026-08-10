// Madden 27 EA cross-reference pass — EA.com is now the source of truth for player
// ratings (see docs/madden-fantasy-draft-plan.md §12 progress log).
//
// Reads the EA scrape (data/madden27/madden27_ea_players.csv, produced by
// madden27-ea-scrape.ts) and PATCHes the active madden_27 baseline dataset:
//   - every matched player's 53 attributes + identity + position/archetype are
//     overwritten with EA's values (EA authoritative; per Samuel's directive,
//     "matching values are confirmed and stored permanently, non-matching values
//     default to the EA value"),
//   - dev_trait is derived from EA ability types (xfactor / superstar / normal; EA's
//     public site exposes no Star-vs-Normal signal — its silver-star badge is a rendered
//     overlay, not data — so ability-less players read as 'normal'),
//   - abilities_raw is rewritten as structured JSON [{id,label,type}] (the full catalog
//     with descriptions lives in madden27_ea_abilities_catalog.json for tooltips),
//   - ea_player_id / height / weight / handedness are stored,
//   - placeholders + M26 rows that match EA are upgraded to data_quality 'rated',
//   - rows with an empty photo_url get EA's official portrait re-hosted to Cloudflare.
// Unmatched rows (mostly real-life free agents — EA publishes only the 32 team rosters)
// are left untouched and reported.
//
// Run: pnpm --filter @rec/api exec tsx scripts/madden27-ea-crossref.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const EA_CSV = join(DATA_DIR, "madden27_ea_players.csv");
const UNMATCHED_CSV = join(DATA_DIR, "madden27_ea_unmatched.csv");
const GAME_TITLE = "madden_27";

const REST_URL = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// EA stat columns in the compact CSV are named after the baseline DB columns already.
const ATTRIBUTE_COLUMNS = [
  "speed", "acceleration", "strength", "agility", "awareness", "jumping", "injury", "stamina", "toughness",
  "throw_power", "throw_under_pressure", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "throw_on_the_run", "play_action",
  "catching", "spectacular_catch", "catch_in_traffic", "route_running_short", "route_running_medium", "route_running_deep", "release",
  "carrying", "break_tackle", "trucking", "change_of_direction", "bc_vision", "stiff_arm", "spin_move", "juke_move", "break_sack",
  "tackle", "power_moves", "finesse_moves", "block_shedding", "pursuit", "play_recognition", "man_coverage", "zone_coverage", "hit_power", "press",
  "run_block", "pass_block", "impact_blocking", "run_block_power", "run_block_finesse", "pass_block_power", "pass_block_finesse", "lead_block",
  "kick_power", "kick_accuracy", "kick_return",
];

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
// "New York Giants" (maddenratings) vs "NY Giants" (EA) are the same team.
function normTeam(team: string | null | undefined): string {
  return (team ?? "").toLowerCase().replace(/new\s+york/g, "ny").replace(/\s+/g, " ").trim();
}
function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text: string): Array<Record<string, string>> {
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

function toCsv(rows: Array<Record<string, string>>, header: string[]): string {
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [header.map((h) => escape(h)).join(","), ...rows.map((r) => header.map((h) => escape(r[h] ?? "")).join(","))].join("\n") + "\n";
}

// Cloudflare photo re-host — same primitive the seed uses (download binary, upload with
// stable id `madden27-<slug>`, delete-then-retry on duplicate-id, delivery URL from hash).
const CF_IMAGES_API = "https://api.cloudflare.com/client/v4";
async function rehostPhoto(sourceUrl: string, slug: string): Promise<string> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  const accountHash = env.CLOUDFLARE_ACCOUNT_HASH?.trim() ?? "";
  if (!accountId || !apiToken || !sourceUrl) return "";
  async function download() {
    try {
      const res = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      return { buffer: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/png" };
    } catch { return null; }
  }
  async function upload(): Promise<string> {
    const dl = await download();
    if (!dl) return "";
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
      const payload = await res.json().catch(() => null) as { success?: boolean; result?: { variants?: string[] } } | null;
      if (!res.ok || !payload?.success || !payload.result?.variants?.length) return "";
      return accountHash ? `https://imagedelivery.net/${accountHash}/madden27-${slug}/public` : payload.result.variants[0];
    } catch { return ""; }
  }
  let url = await upload();
  if (!url) {
    await fetch(`${CF_IMAGES_API}/accounts/${accountId}/images/v1/madden27-${slug}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    }).catch(() => {});
    url = await upload();
  }
  return url;
}

async function main() {
  if (!existsSync(EA_CSV)) throw new Error(`Missing EA scrape: ${EA_CSV}. Run madden27-ea-scrape.ts first.`);
  const eaRows = parseCsv(readFileSync(EA_CSV, "utf8"));
  console.log(`Loaded ${eaRows.length} EA players.`);

  // Normalized-name -> EA rows (a handful of duplicate names exist league-wide).
  const eaLookup = new Map<string, Array<Record<string, string>>>();
  const push = (key: string, row: Record<string, string>) => {
    if (!key) return;
    const arr = eaLookup.get(key) ?? [];
    arr.push(row);
    eaLookup.set(key, arr);
  };
  for (const row of eaRows) {
    const base = normalizeName(row.name);
    push(base, row);
    const ns = normalizeName(stripSuffix(row.name));
    if (ns && ns !== base) push(ns, row);
  }

  const datasets = await fetch(`${REST_URL}/rec_madden_roster_datasets?select=id&game_title=eq.${GAME_TITLE}&is_active=eq.true`, { headers: restHeaders() }).then((r) => r.json()) as Array<{ id: string }>;
  if (!datasets.length) throw new Error("No active madden_27 dataset found.");
  const datasetId = datasets[0].id;

  const dbRows: Array<Record<string, any>> = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await fetch(
      `${REST_URL}/rec_madden_baseline_players?select=id,source_slug,name,team_abbreviation,position,overall_rating,photo_url,data_quality,abilities_raw&dataset_id=eq.${datasetId}&offset=${offset}&limit=1000`,
      { headers: restHeaders() },
    ).then((r) => r.json()) as Array<Record<string, any>>;
    if (!rows.length) break;
    dbRows.push(...rows);
  }
  console.log(`Loaded ${dbRows.length} baseline rows.`);

  let matched = 0, teamMatched = 0, nameOnlyMatched = 0;
  let upgradedPlaceholder = 0, upgradedBackfilled = 0;
  let photoBackfilled = 0;
  let ovrChanged = 0, ovrDeltaSum = 0, ovrDeltaMax = 0;
  const ovrChanges: Array<{ name: string; old: number | null; next: number }> = [];
  let positionChanged = 0;
  const positionChanges: Array<{ name: string; old: string; next: string }> = [];
  const unmatched: Array<Record<string, string>> = [];
  const patches: Array<{ row: Record<string, any>; patch: Record<string, unknown>; newOvr: number | null; oldOvr: number | null }> = [];

  for (const row of dbRows) {
    const base = normalizeName(row.name);
    let candidates = eaLookup.get(base) ?? eaLookup.get(normalizeName(stripSuffix(row.name))) ?? [];
    if (!candidates.length) { unmatched.push({ name: row.name, team: row.team_abbreviation ?? "", position: row.position, data_quality: row.data_quality }); continue; }

    let ea = candidates.length === 1 ? candidates[0] : undefined;
    if (!ea) {
      // Same-name collisions: prefer the one on the same team as our row.
      const sameTeam = candidates.filter((c) => normTeam(c.team_label) === normTeam(row.team_abbreviation));
      ea = sameTeam.length === 1 ? sameTeam[0] : undefined;
    }
    if (!ea) { unmatched.push({ name: row.name, team: row.team_abbreviation ?? "", position: row.position, data_quality: row.data_quality }); continue; }

    if (normTeam(ea.team_label) === normTeam(row.team_abbreviation)) teamMatched++; else nameOnlyMatched++;

    const patch: Record<string, unknown> = {};
    for (const col of ATTRIBUTE_COLUMNS) patch[col] = num(ea[col]);
    patch.overall_rating = num(ea.overall);
    patch.position = ea.position;
    patch.position_full = ea.position_full || null;
    patch.jersey_number = num(ea.jersey);
    patch.age = num(ea.age);
    patch.date_of_birth = ea.dob || null;
    patch.college = ea.college || null;
    patch.years_pro = num(ea.years_pro);
    patch.archetype = ea.archetype || null;
    patch.dev_trait = ea.dev_trait || null;
    patch.ea_player_id = num(ea.ea_player_id);
    patch.height_inches = num(ea.height_inches);
    patch.weight_lbs = num(ea.weight_lbs);
    patch.handedness = ea.handedness === "0" ? "left" : ea.handedness === "1" ? "right" : null;
    patch.abilities_raw = ea.abilities_json || null;
    patch.total_attributes = ATTRIBUTE_COLUMNS.filter((c) => num(ea[c]) !== null).length || null;

    const newOvr = num(ea.overall);
    if (row.overall_rating != null && newOvr != null && row.overall_rating !== newOvr) {
      ovrChanged++;
      const delta = Math.abs(row.overall_rating - newOvr);
      ovrDeltaSum += delta;
      ovrDeltaMax = Math.max(ovrDeltaMax, delta);
      ovrChanges.push({ name: row.name, old: row.overall_rating, next: newOvr });
    }
    if (row.position && row.position !== ea.position) {
      positionChanged++;
      positionChanges.push({ name: row.name, old: row.position, next: ea.position });
    }

    if (row.data_quality === "placeholder") upgradedPlaceholder++;
    if (row.data_quality === "backfilled_prior_year") upgradedBackfilled++;
    patch.data_quality = "rated";

    // Official EA portrait for rows that never had a photo.
    if (!row.photo_url && ea.avatar_url) {
      const hosted = await rehostPhoto(ea.avatar_url, String(row.source_slug));
      if (hosted) { patch.photo_url = hosted; photoBackfilled++; }
    }

    matched++;
    patches.push({ row, patch, newOvr, oldOvr: row.overall_rating ?? null });
  }

  console.log(`Matched ${matched}/${dbRows.length} (${teamMatched} team-confirmed, ${nameOnlyMatched} name-only). Unmatched: ${unmatched.length}.`);
  console.log(`Upgrades: ${upgradedPlaceholder} placeholder, ${upgradedBackfilled} backfilled_prior_year -> rated. Photo backfills: ${photoBackfilled}.`);
  console.log(`OVR diffs: ${ovrChanged} changed (mean |delta| ${ovrChanged ? (ovrDeltaSum / ovrChanged).toFixed(1) : "0"}, max ${ovrDeltaMax}). Position changes: ${positionChanged}.`);

  const traitDist: Record<string, number> = {};
  for (const row of dbRows) {
    const m = patches.find((p) => p.row.id === row.id);
    const t = m ? m.patch.dev_trait : row.dev_trait;
    if (t) traitDist[String(t)] = (traitDist[String(t)] ?? 0) + 1;
  }
  console.log("Dev-trait distribution (baseline rows):", Object.entries(traitDist).map(([k, v]) => `${k}=${v}`).join(", "));

  const CONCURRENCY = 12;
  let nextIdx = 0, patched = 0, failed = 0;
  const worker = async () => {
    while (nextIdx < patches.length) {
      const { row, patch } = patches[nextIdx++];
      const res = await fetch(`${REST_URL}/rec_madden_baseline_players?id=eq.${row.id}`, {
        method: "PATCH",
        headers: restHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify(patch),
      });
      if (res.ok) patched++; else { failed++; console.warn(`  PATCH failed for ${row.name}: ${res.status} ${await res.text()}`); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Patched ${patched} rows (${failed} failed).`);

  if (unmatched.length) {
    writeFileSync(UNMATCHED_CSV, toCsv(unmatched, ["name", "team", "position", "data_quality"]));
    console.log(`Wrote ${unmatched.length} unmatched to ${UNMATCHED_CSV}`);
  }
  const big = ovrChanges.filter((c) => c.old !== null && Math.abs(c.old - c.next) >= 10).sort((a, b) => b.next - a.next);
  console.log(`OVR swings >=10 (${big.length}):`, big.slice(0, 25).map((c) => `${c.name} ${c.old}->${c.next}`).join(", ") || "none");
  console.log(`Sample position changes (${positionChanges.length}):`, positionChanges.slice(0, 30).map((c) => `${c.name} ${c.old}->${c.next}`).join(", ") || "none");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
