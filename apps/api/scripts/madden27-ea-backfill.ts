// Madden 27 EA backfill — players present on EA's official 32 team rosters but missing
// from the active madden_27 baseline dataset (name+team gap), plus misc name/placeholder
// repairs that the name matcher mis-handled.
//
// Computes the missing set the same way diag-missing2 did, but with corrected name
// normalization (strip the trailing-period form of Jr/Sr/II/III/IV — "Brock Purdy"
// vs "Michael Penix Jr."; earlier matching skipped '.' so "Kris Jenkins Jr." never
// matched "Kris Jenkins Jr", inflating the missing count to 82. The corrected set is 49.)
//
// The 45 player rows are genuinely absent: inserted into rec_madden_baseline_players
// (full EA attributes + abilities + re-hosted Cloudflare photo) and into both live
// leagues:
//   - regular_rosters league (589e59a0... "M27 Regs - REC Lgz"): assigned to their real
//     team (mirrors applyMaddenBaselineToLeague team matching),
//   - fantasy_draft league (e342e8bd... "M27 - The OG REC", draft "live"): inserted with
//     team_id null so they land in the draft pool.
// The remaining 4 are already present but wrong: 2 name typos (Chris Roland-Wallace,
// Josh Hines-Allen) and 2 placeholder stubs upgraded to full EA data (Malaesala
// Aumavae-Laulu, Julian Good-Jones). Those are PATCHed in the baseline and both leagues.
//
// abilities: EA's abilities_json is [{id,label,type}]; the league rec_players.abilities
// column stores [{name,description}]. Descriptions are resolved from the committed
// abilities catalog (apps/api/scripts/data/madden27/madden27_ea_abilities_catalog.json),
// matching how crossed rows already look in the leagues. The baseline keeps abilities_raw
// as the raw EA JSON (same as madden27-ea-crossref.ts writes).
//
// Run: pnpm --filter @rec/api exec tsx scripts/madden27-ea-backfill.ts
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const EA_CSV = join(DATA_DIR, "madden27_ea_players.csv");
const CATALOG_JSON = join(DATA_DIR, "madden27_ea_abilities_catalog.json");
const GAME_TITLE = "madden_27";
const SKIP_PHOTOS = process.argv.includes("--skip-photos");
const DRY_RUN = process.argv.includes("--dry-run");

const REGULAR_LEAGUE_ID = "589e59a0-5513-4e7c-b55c-6c83c71a9634";
const FANTASY_LEAGUE_ID = "e342e8bd-71ad-40f6-96f9-2731d702755c";

const REST_URL = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

const ATTRIBUTE_COLUMNS = [
  "speed", "acceleration", "strength", "agility", "awareness", "jumping", "injury", "stamina", "toughness",
  "throw_power", "throw_under_pressure", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "throw_on_the_run", "play_action",
  "catching", "spectacular_catch", "catch_in_traffic", "route_running_short", "route_running_medium", "route_running_deep", "release",
  "carrying", "break_tackle", "trucking", "change_of_direction", "bc_vision", "stiff_arm", "spin_move", "juke_move", "break_sack",
  "tackle", "power_moves", "finesse_moves", "block_shedding", "pursuit", "play_recognition", "man_coverage", "zone_coverage", "hit_power", "press",
  "run_block", "pass_block", "impact_blocking", "run_block_power", "run_block_finesse", "pass_block_power", "pass_block_finesse", "lead_block",
  "kick_power", "kick_accuracy", "kick_return",
];

type EaRow = Record<string, string>;
type CatalogEntry = { id: string; label: string; description: string; type: { id: string; label: string } };
type MissingPlayer = { ea: EaRow; slug: string; teamAbbreviation: string | null; abilities: Array<{ name: string; description: string }> | null; photoUrl: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** Canonical player name for matching: lower, '.'->'', suffix stripped AFTER removing periods. */
function canonName(name: string): string {
  const withoutPeriods = decodeEntities(name).toLowerCase().replace(/\./g, "").replace(/[\u2019\u2018]/g, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
  return withoutPeriods.replace(/\s+(jr|sr|ii|iii|iv)$/i, "");
}
function normTeam(team: string | null | undefined): string {
  return (team ?? "").toLowerCase().replace(/new\s+york/g, "ny").replace(/\s+/g, " ").trim();
}
function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function handednessOf(v: string | undefined): string | null {
  return v === "0" ? "left" : v === "1" ? "right" : null;
}

type ParsedAbility = { name: string; description: string };
const catalog: CatalogEntry[] = JSON.parse(readFileSync(CATALOG_JSON, "utf8")) as CatalogEntry[];
const catalogById = new Map<string, CatalogEntry>(catalog.map((a) => [String(a.id), a]));
function resolveAbilities(ea: EaRow): ParsedAbility[] | null {
  const raw = ea.abilities_json;
  if (!raw || raw.length <= 2) return null;
  const arr = (JSON.parse(raw) as Array<{ id: string; label: string }>);
  return arr.map((a) => {
    const entry = catalogById.get(String(a.id));
    return { name: entry?.label ?? a.label ?? "", description: entry?.description ?? "" };
  });
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

async function restInsert(table: string, rows: unknown[]): Promise<void> {
  if (DRY_RUN) { console.log(`  [dry-run] would INSERT ${rows.length} into ${table}`); return; }
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const res = await fetch(`${REST_URL}/${table}`, {
      method: "POST",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(rows.slice(i, i + batchSize)),
    });
    if (!res.ok) throw new Error(`INSERT ${table} [${i}-${i + batchSize}]: ${res.status} ${await res.text()}`);
  }
}
async function restPatch(table: string, query: string, patch: unknown): Promise<void> {
  if (DRY_RUN) { console.log(`  [dry-run] would PATCH ${table} ${query}`); return; }
  const res = await fetch(`${REST_URL}/${table}?${query}`, {
    method: "PATCH",
    headers: restHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH ${table}?${query}: ${res.status} ${await res.text()}`);
}

type LeagueTeam = { id: string; name: string };
async function loadLeagueTeams(leagueId: string): Promise<Map<string, string>> {
  const res = await fetch(`${REST_URL}/rec_teams?select=id,name&league_id=eq.${leagueId}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`Failed to load teams: ${res.status}`);
  const teams = (await res.json()) as LeagueTeam[];
  return new Map(teams.map((t) => [String(t.name).trim().toUpperCase(), t.id as string]));
}

// Team_abbreviation on the baseline stores the full *league* team name (e.g. "New York
// Giants"), matching rec_teams.name. EA labels differ only for the NY clubs ("NY Giants"
// => "New York Giants"), so normalize via the Team -> league name map below.
async function loadCanonicalTeamNames(): Promise<Map<string, string>> {
  const res = await fetch(`${REST_URL}/rec_teams?select=name&league_id=eq.${FANTASY_LEAGUE_ID}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`Failed to load team names: ${res.status}`);
  const teams = (await res.json()) as LeagueTeam[];
  const map = new Map<string, string>();
  for (const t of teams) {
    const key = normTeam(t.name);
    if (!map.has(key)) map.set(key, t.name);
  }
  return map;
}

async function main() {
  if (!existsSync(EA_CSV)) throw new Error(`Missing EA scrape: ${EA_CSV}`);
  const eaRows = parseCsv(readFileSync(EA_CSV, "utf8"));
  console.log(`Loaded ${eaRows.length} EA players.`);

  const datasets = await fetch(`${REST_URL}/rec_madden_roster_datasets?select=id&game_title=eq.${GAME_TITLE}&is_active=eq.true`, { headers: restHeaders() }).then((r) => r.json()) as Array<{ id: string }>;
  if (!datasets.length) throw new Error("No active madden_27 dataset found.");
  const datasetId = datasets[0].id;
  const canonicalTeams = await loadCanonicalTeamNames();

  const baseline: Array<{ source_slug: string; name: string; team_abbreviation: string | null }> = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await fetch(
      `${REST_URL}/rec_madden_baseline_players?select=source_slug,name,team_abbreviation&dataset_id=eq.${datasetId}&offset=${offset}&limit=1000`,
      { headers: restHeaders() },
    ).then((r) => r.json()) as Array<{ source_slug: string; name: string; team_abbreviation: string | null }>;
    if (!rows.length) break;
    baseline.push(...rows);
  }
  console.log(`Loaded ${baseline.length} baseline rows.`);

  const existingSlugs = new Set(baseline.map((r) => r.source_slug));

  // name|team keys from the baseline; canonName strips suffix AFTER removing periods so
  // "Kris Jenkins Jr." === "Kris Jenkins Jr" (the earlier diag inverted this, inflating 49
  // to 82 "missing" — every one of the 33 extras already had a baseline row).
  const baseKey = new Set<string>();
  for (const r of baseline) baseKey.add(`${canonName(r.name)}|${normTeam(r.team_abbreviation)}`);

  // The 4 players the corrected matcher *does* flag but that already exist under broken
  // names/placeholder stubs — handled via PATCH, not insert.
  const FIX_SLUGS = ["chris-roland-wallace", "josh-hines-allen", "malaesala-aumavae-laulu", "julian-good-jones"] as const;

  const toInsert: MissingPlayer[] = [];
  for (const ea of eaRows) {
    const key = `${canonName(ea.name)}|${normTeam(ea.team_label)}`;
    if (baseKey.has(key)) continue;
    const nameAlreadyExists = [...baseKey].some((k) => k.startsWith(`${canonName(ea.name)}|`));
    if (nameAlreadyExists) continue;
    const slug = slugOf(ea.name);
    if ((FIX_SLUGS as readonly string[]).includes(slug)) continue;
    if (existingSlugs.has(slug)) throw new Error(`Slug collision: ${slug} (${ea.name})`);
    const teamLabel = normTeam(ea.team_label);
    toInsert.push({
      ea,
      slug,
      teamAbbreviation: canonicalTeams.get(teamLabel) ?? (ea.team_label || null),
      abilities: resolveAbilities(ea),
      photoUrl: "",
    });
  }
  console.log(`Total EA: ${eaRows.length}. Inserting ${toInsert.length} clean players missing from both baseline and leagues.`);

  // Rehost photos across the set before touching the DB so the insert rows are final.
  if (!DRY_RUN) {
    for (const p of toInsert) {
      if (!SKIP_PHOTOS && p.ea.avatar_url) p.photoUrl = await rehostPhoto(p.ea.avatar_url, p.slug);
    }
  }

  const baselineInsertRows = toInsert.map((p) => {
    const ea = p.ea;
    const attrs: Record<string, number | null> = {};
    for (const col of ATTRIBUTE_COLUMNS) attrs[col] = num(ea[col]);
    const row: Record<string, unknown> = {
      dataset_id: datasetId,
      source_slug: p.slug,
      name: decodeEntities(ea.name),
      team_abbreviation: p.teamAbbreviation,
      position: ea.position,
      position_full: ea.position_full || null,
      jersey_number: num(ea.jersey),
      archetype: ea.archetype || null,
      overall_rating: num(ea.overall),
      age: num(ea.age),
      date_of_birth: ea.dob || null,
      nationality: null,
      college: ea.college || null,
      years_pro: num(ea.years_pro),
      draft_year: null,
      draft_pick_overall: null,
      drafted_by_team: null,
      photo_url: p.photoUrl,
      abilities_raw: ea.abilities_json || null,
      data_quality: "rated",
      ...attrs,
      total_attributes: ATTRIBUTE_COLUMNS.filter((c) => num(ea[c]) !== null).length || null,
      dev_trait: ea.dev_trait || null,
      ea_player_id: num(ea.ea_player_id),
      height_inches: num(ea.height_inches),
      weight_lbs: num(ea.weight_lbs),
      handedness: handednessOf(ea.handedness),
    };
    return row;
  });

  if (baselineInsertRows.length) {
    await restInsert("rec_madden_baseline_players", baselineInsertRows);
    console.log(`Inserted ${baselineInsertRows.length} baseline players into dataset ${datasetId}.`);
  }

  // Apply to both leagues (teamId null for the fantasy pool; real team for regular_rosters).
  const regularTeams = await loadLeagueTeams(REGULAR_LEAGUE_ID);
  const leagueNames = ["regular_rosters", "fantasy_draft (pool)"] as const;
  for (const mode of leagueNames) {
    const leagueId = mode === "regular_rosters" ? REGULAR_LEAGUE_ID : FANTASY_LEAGUE_ID;
    const rows = toInsert.map((p) => {
      const ea = p.ea;
      const cleanName = decodeEntities(ea.name);
      const nameParts = cleanName.trim().split(/\s+/);
      const firstName = nameParts[0] ?? cleanName;
      const lastName = nameParts.slice(1).join(" ") || cleanName;
      const attributes: Record<string, number | null> = {};
      for (const col of ATTRIBUTE_COLUMNS) attributes[col] = num(ea[col]);
      let teamId: string | null = null;
      if (mode === "regular_rosters" && p.teamAbbreviation) {
        teamId = regularTeams.get(p.teamAbbreviation.trim().toUpperCase()) ?? null;
      }
      return {
        league_id: leagueId,
        team_id: teamId,
        madden_player_id: `madden27:${p.slug}`,
        first_name: firstName,
        last_name: lastName,
        full_name: cleanName,
        position: ea.position,
        overall_rating: num(ea.overall),
        jersey_number: num(ea.jersey),
        archetype: ea.archetype || null,
        height_inches: num(ea.height_inches),
        weight_lbs: num(ea.weight_lbs),
        handedness: handednessOf(ea.handedness),
        dev_trait: ea.dev_trait || null,
        attributes,
        abilities: p.abilities,
        ability_count: p.abilities ? p.abilities.length : null,
        college: ea.college || null,
        birth_year: ea.dob ? new Date(ea.dob).getUTCFullYear() : null,
        years_pro: num(ea.years_pro),
        photo_url: p.photoUrl,
        is_free_agent: !teamId,
        roster_status: "active",
        is_default_player: true,
        player_source: "imported",
      };
    });
    await restInsert("rec_players", rows);
    const poolNote = mode === "regular_rosters" ? "assigned to real teams" : "added to draft pool (team_id null)";
    console.log(`Inserted ${rows.length} into ${mode} league (${poolNote}).`);
  }

  // ---- Repairs for the 4 existing-but-wrong rows ----
  // 1) name typos (photo + ratings already correct)
  const nameFixes = [
    { slug: "chris-roland-wallace", name: "Chris Roland-Wallace" },
    { slug: "josh-hines-allen", name: "Josh Hines-Allen" },
  ];
  for (const fix of nameFixes) {
    const baselinePatch = { name: fix.name };
    const leaguePatch = (() => {
      const parts = fix.name.trim().split(/\s+/);
      return { first_name: parts[0], last_name: parts.slice(1).join(" ") || fix.name, full_name: fix.name };
    })();
    await restPatch("rec_madden_baseline_players", `dataset_id=eq.${datasetId}&source_slug=eq.${fix.slug}`, baselinePatch);
    for (const leagueId of [REGULAR_LEAGUE_ID, FANTASY_LEAGUE_ID]) {
      await restPatch("rec_players", `league_id=eq.${leagueId}&madden_player_id=eq.madden27:${fix.slug}`, leaguePatch);
    }
    console.log(`Fixed name ${fix.slug} -> "${fix.name}" (baseline + both leagues).`);
  }

  // 2) placeholder stubs upgraded to full EA data
  const stubSlugs = ["malaesala-aumavae-laulu", "julian-good-jones"];
  for (const slug of stubSlugs) {
    const ea = eaRows.find((r) => slugOf(r.name) === slug);
    if (!ea) throw new Error(`Missing EA row for stub ${slug}`);
    const teamAbbreviation = canonicalTeams.get(normTeam(ea.team_label)) ?? (ea.team_label || null);
    const abilities = resolveAbilities(ea);
    const attrs: Record<string, number | null> = {};
    for (const col of ATTRIBUTE_COLUMNS) attrs[col] = num(ea[col]);
    let photoUrl = "";
    if (!DRY_RUN && !SKIP_PHOTOS && ea.avatar_url) photoUrl = await rehostPhoto(ea.avatar_url, slug);

    const baselinePatch: Record<string, unknown> = {
      name: decodeEntities(ea.name),
      team_abbreviation: teamAbbreviation,
      position: ea.position,
      position_full: ea.position_full || null,
      jersey_number: num(ea.jersey),
      archetype: ea.archetype || null,
      overall_rating: num(ea.overall),
      age: num(ea.age),
      date_of_birth: ea.dob || null,
      college: ea.college || null,
      years_pro: num(ea.years_pro),
      photo_url: photoUrl,
      abilities_raw: ea.abilities_json || null,
      data_quality: "rated",
      ...attrs,
      total_attributes: ATTRIBUTE_COLUMNS.filter((c) => num(ea[c]) !== null).length || null,
      dev_trait: ea.dev_trait || null,
      ea_player_id: num(ea.ea_player_id),
      height_inches: num(ea.height_inches),
      weight_lbs: num(ea.weight_lbs),
      handedness: handednessOf(ea.handedness),
    };
    await restPatch("rec_madden_baseline_players", `dataset_id=eq.${datasetId}&source_slug=eq.${slug}`, baselinePatch);

    const parts = decodeEntities(ea.name).trim().split(/\s+/);
    const firstName = parts[0] ?? ea.name;
    const lastName = parts.slice(1).join(" ") || ea.name;
    let regularTeamId: string | null = null;
    if (teamAbbreviation) regularTeamId = regularTeams.get(teamAbbreviation.trim().toUpperCase()) ?? null;
    const commonPatch: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      full_name: decodeEntities(ea.name),
      position: ea.position,
      overall_rating: num(ea.overall),
      jersey_number: num(ea.jersey),
      archetype: ea.archetype || null,
      height_inches: num(ea.height_inches),
      weight_lbs: num(ea.weight_lbs),
      handedness: handednessOf(ea.handedness),
      dev_trait: ea.dev_trait || null,
      attributes: attrs,
      abilities,
      ability_count: abilities ? abilities.length : null,
      college: ea.college || null,
      birth_year: ea.dob ? new Date(ea.dob).getUTCFullYear() : null,
      years_pro: num(ea.years_pro),
      photo_url: photoUrl,
    };
    const regularPatch = { ...commonPatch, team_id: regularTeamId, is_free_agent: !regularTeamId };
    const fantasyPatch = { ...commonPatch, is_free_agent: true };
    await restPatch("rec_players", `league_id=eq.${REGULAR_LEAGUE_ID}&madden_player_id=eq.madden27:${slug}`, regularPatch);
    await restPatch("rec_players", `league_id=eq.${FANTASY_LEAGUE_ID}&madden_player_id=eq.madden27:${slug}`, fantasyPatch);
    console.log(`Upgraded stub ${slug} -> "${decodeEntities(ea.name)}" (${ea.position} OVR ${ea.overall}, ${teamAbbreviation}) in baseline + both leagues.`);
  }

  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});