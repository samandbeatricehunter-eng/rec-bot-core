// Madden 26 ratings backfill for the unrated stub players (plan doc §1/§12): Samuel supplied
// per-team Madden 26 rating CSVs (apps/api/scripts/data/madden26/madden-ratings-*.csv,
// pulled from leaguestation.com). This script matches each unrated stub player by name to a
// Madden 26 row, maps the M26 attribute columns onto the madden_27 baseline flat columns,
// and PATCHes the existing rows in the active dataset. It also repairs the ~18 stub rows
// whose scraped name was lost ("Madden 27 Ratings Database") by deriving the name from the
// URL slug, and writes the corrected stub CSV back so future seed re-runs are consistent
// (the seed itself loads the M26 CSVs the same way — see madden-baseline-seed.ts).
//
// Run: pnpm --filter @rec/api exec tsx scripts/madden26-stub-backfill.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const M26_DIR = join(__dirname, "data", "madden26");
const STUBS_CSV = join(DATA_DIR, "madden27_unrated_players_final.csv");
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

// Madden 26 CSV header -> madden_27 baseline DB column. M26 has no injury/kicking columns;
// those stay null on backfilled rows.
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

const JUNK_NAME = "Madden 27 Ratings Database";

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

function toCsv(rows: Record<string, string>[], header: string[]): string {
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [header.map((h) => escape(h)).join(","), ...rows.map((r) => header.map((h) => escape(r[h] ?? "")).join(","))].join("\n") + "\n";
}

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
  const slug = url.replace(/^https?:\/\/www\.maddenratings\.com\//, "").replace(/\/$/, "");
  return slug.split("-").filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!existsSync(join(M26_DIR, "madden-ratings-ARI.csv"))) throw new Error("Missing madden26 CSVs in " + M26_DIR);

  const m26Rows: Array<Record<string, string>> = [];
  for (const file of ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"]) {
    m26Rows.push(...parseCsv(readFileSync(join(M26_DIR, `madden-ratings-${file}.csv`), "utf8")));
  }
  console.log(`Loaded ${m26Rows.length} Madden 26 players from ${m26Rows.length ? 32 : 0} team CSVs.`);

  // Normalized-name -> M26 row, with suffix-stripped variants as a fallback key.
  const m26Lookup = new Map<string, Record<string, string>>();
  for (const row of m26Rows) {
    const n = normalizeName(row.Player);
    if (!n) continue;
    if (!m26Lookup.has(n)) m26Lookup.set(n, row);
    const ns = normalizeName(stripSuffix(row.Player));
    if (ns && ns !== n && !m26Lookup.has(ns)) m26Lookup.set(ns, row);
  }

  const stubs = parseCsv(readFileSync(STUBS_CSV, "utf8"));
  console.log(`Loaded ${stubs.length} stub players.`);

  // Repairs + matching.
  let fixedNames = 0, matched = 0;
  const backfilled: Array<{ row: Record<string, string>; m26: Record<string, string> }> = [];
  for (const row of stubs) {
    if (row.name === JUNK_NAME) {
      const derived = slugName(row.url);
      if (derived) { row.name = derived; fixedNames++; }
    }
    const base = normalizeName(row.name);
    const m26 = m26Lookup.get(base) ?? m26Lookup.get(normalizeName(stripSuffix(row.name)));
    if (m26) {
      row.dataSource = "Madden NFL 26 (backfilled)";
      row.position = m26.Position || row.position;
      row.ovr = m26.Overall || row.ovr;
      matched++;
      backfilled.push({ row, m26 });
    }
  }
  console.log(`Repaired ${fixedNames} lost stub names from slugs; ${matched} stubs matched to Madden 26 ratings.`);

  const dataset = await fetch(`${REST_URL}/rec_madden_roster_datasets?select=id&game_title=eq.${GAME_TITLE}&is_active=eq.true`, { headers: restHeaders() }).then((r) => r.json()) as Array<{ id: string }>;
  if (!dataset.length) throw new Error("No active madden_27 dataset found.");
  const datasetId = dataset[0].id;

  const dbRows: Array<Record<string, string>> = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const rows = await fetch(
      `${REST_URL}/rec_madden_baseline_players?select=id,source_slug,name&dataset_id=eq.${datasetId}&data_quality=neq.rated&offset=${offset}&limit=1000`,
      { headers: restHeaders() },
    ).then((r) => r.json()) as Array<Record<string, string>>;
    if (!rows.length) break;
    dbRows.push(...rows);
  }
  const bySlug = new Map(dbRows.map((r) => [r.source_slug, r]));
  console.log(`Fetched ${dbRows.length} non-rated baseline rows.`);

  let patched = 0, nameFixedInDb = 0, notFound = 0;
  const patchedSlugs = new Set<string>();
  for (const { row, m26 } of backfilled) {
    const slug = row.url.replace(/^https?:\/\/www\.maddenratings\.com\//, "").replace(/\/$/, "");
    const db = bySlug.get(slug);
    if (!db) { notFound++; continue; }
    const patch: Record<string, unknown> = {
      name: row.name,
      position: row.position || null,
      overall_rating: num(row.ovr),
      data_quality: "backfilled_prior_year",
    };
    let attrCount = 0;
    for (const [m26Col, dbCol] of Object.entries(M26_ATTRIBUTE_MAP)) {
      const v = num(m26[m26Col]);
      patch[dbCol] = v;
      if (v !== null) attrCount++;
    }
    patch.total_attributes = attrCount || null;
    if (db.name !== row.name) nameFixedInDb++;
    const res = await fetch(`${REST_URL}/rec_madden_baseline_players?id=eq.${db.id}`, {
      method: "PATCH",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) { console.warn(`  PATCH failed for ${slug}: ${res.status} ${await res.text()}`); continue; }
    patched++;
    patchedSlugs.add(slug);
  }

  // Name-only fixes for repaired rows that never matched M26 (their DB name is still the
  // scrape-artifact string).
  let nameOnly = 0;
  for (const row of stubs) {
    const slug = row.url.replace(/^https?:\/\/www\.maddenratings\.com\//, "").replace(/\/$/, "");
    if (patchedSlugs.has(slug)) continue;
    const db = bySlug.get(slug);
    if (!db || db.name === row.name) continue;
    const res = await fetch(`${REST_URL}/rec_madden_baseline_players?id=eq.${db.id}`, {
      method: "PATCH",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ name: row.name }),
    });
    if (res.ok) nameOnly++;
  }

  writeFileSync(STUBS_CSV, toCsv(stubs, ["college", "dataSource", "draftClass", "image", "name", "nationality", "ovr", "position", "realLifeRosterStatus", "team", "url"]));
  console.log(`Patched ${patched} baseline rows (${nameFixedInDb} name fixes), ${notFound} matched stubs had no DB row, ${nameOnly} name-only fixes. Stub CSV rewritten.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
