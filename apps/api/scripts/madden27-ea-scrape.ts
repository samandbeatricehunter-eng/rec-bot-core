// Madden 27 EA ratings scrape — pulls the *official* EA ratings (ea.com) that the
// maddenratings.com fan-site CSVs were missing. See docs/madden-fantasy-draft-plan.md
// §12 progress log for the full EA cross-reference work this belongs to.
//
// EA's ratings pages are a Next.js app; every team page embeds its full roster as
// `__NEXT_DATA__` JSON (74 players × 55 stats + abilities). The index page embeds the
// complete ability catalog (`ratingsFilters.playerAbilities`), which we save for the
// tooltip descriptions on the players page.
//
// Outputs:
//   data/madden27/madden27_ea_abilities_catalog.json   (committed) — {id,label,description,type}
//   data/madden27/ea/raw/<team-slug>.json              (gitignored) — per-team raw items
//   data/madden27/madden27_ea_players.csv              (committed) — compact flat rows, header =
//     DB column names so madden27-ea-crossref.ts and the seed can consume it directly
//
// Resumable: finished teams' raw dumps are skipped on re-run. Politeness: 3 concurrent
// workers, 4 retries with backoff. EA's public site is the same data the fan sites
// mirror; there is no free-agent page (32 team rosters = the whole league).
//
// Run: pnpm --filter @rec/api exec tsx scripts/madden27-ea-scrape.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const RAW_DIR = join(DATA_DIR, "ea", "raw");
const CATALOG_PATH = join(DATA_DIR, "madden27_ea_abilities_catalog.json");
const PLAYERS_CSV = join(DATA_DIR, "madden27_ea_players.csv");

const BASE = "https://www.ea.com/games/madden-nfl/ratings";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// EA team numeric ids (from the site's own ratingsFilters.teamGroups) — fixed per season.
const TEAMS: Array<{ id: number; slug: string; label: string }> = [
  { id: 1, slug: "chicago-bears", label: "Chicago Bears" },
  { id: 2, slug: "cincinnati-bengals", label: "Cincinnati Bengals" },
  { id: 3, slug: "buffalo-bills", label: "Buffalo Bills" },
  { id: 4, slug: "denver-broncos", label: "Denver Broncos" },
  { id: 5, slug: "cleveland-browns", label: "Cleveland Browns" },
  { id: 6, slug: "tampa-bay-buccaneers", label: "Tampa Bay Buccaneers" },
  { id: 7, slug: "arizona-cardinals", label: "Arizona Cardinals" },
  { id: 8, slug: "los-angeles-chargers", label: "Los Angeles Chargers" },
  { id: 9, slug: "kansas-city-chiefs", label: "Kansas City Chiefs" },
  { id: 10, slug: "indianapolis-colts", label: "Indianapolis Colts" },
  { id: 11, slug: "dallas-cowboys", label: "Dallas Cowboys" },
  { id: 12, slug: "miami-dolphins", label: "Miami Dolphins" },
  { id: 13, slug: "philadelphia-eagles", label: "Philadelphia Eagles" },
  { id: 14, slug: "atlanta-falcons", label: "Atlanta Falcons" },
  { id: 15, slug: "san-francisco-49ers", label: "San Francisco 49ers" },
  { id: 16, slug: "ny-giants", label: "NY Giants" },
  { id: 17, slug: "jacksonville-jaguars", label: "Jacksonville Jaguars" },
  { id: 18, slug: "ny-jets", label: "NY Jets" },
  { id: 19, slug: "detroit-lions", label: "Detroit Lions" },
  { id: 20, slug: "green-bay-packers", label: "Green Bay Packers" },
  { id: 21, slug: "carolina-panthers", label: "Carolina Panthers" },
  { id: 22, slug: "new-england-patriots", label: "New England Patriots" },
  { id: 23, slug: "las-vegas-raiders", label: "Las Vegas Raiders" },
  { id: 24, slug: "los-angeles-rams", label: "Los Angeles Rams" },
  { id: 25, slug: "baltimore-ravens", label: "Baltimore Ravens" },
  { id: 26, slug: "washington-commanders", label: "Washington Commanders" },
  { id: 27, slug: "new-orleans-saints", label: "New Orleans Saints" },
  { id: 28, slug: "seattle-seahawks", label: "Seattle Seahawks" },
  { id: 29, slug: "pittsburgh-steelers", label: "Pittsburgh Steelers" },
  { id: 30, slug: "tennessee-titans", label: "Tennessee Titans" },
  { id: 31, slug: "minnesota-vikings", label: "Minnesota Vikings" },
  { id: 32, slug: "houston-texans", label: "Houston Texans" },
];

// EA stats key -> baseline DB column (same 53-column set as the seed's ATTRIBUTE_COLUMNS).
const EA_STAT_MAP: Record<string, string> = {
  speed: "speed", acceleration: "acceleration", strength: "strength", agility: "agility", awareness: "awareness",
  jumping: "jumping", injury: "injury", stamina: "stamina", toughness: "toughness",
  throwPower: "throw_power", throwUnderPressure: "throw_under_pressure",
  throwAccuracyShort: "throw_accuracy_short", throwAccuracyMid: "throw_accuracy_mid", throwAccuracyDeep: "throw_accuracy_deep",
  throwOnTheRun: "throw_on_the_run", playAction: "play_action",
  catching: "catching", spectacularCatch: "spectacular_catch", catchInTraffic: "catch_in_traffic",
  shortRouteRunning: "route_running_short", mediumRouteRunning: "route_running_medium", deepRouteRunning: "route_running_deep", release: "release",
  carrying: "carrying", breakTackle: "break_tackle", trucking: "trucking", changeOfDirection: "change_of_direction",
  bCVision: "bc_vision", stiffArm: "stiff_arm", spinMove: "spin_move", jukeMove: "juke_move", breakSack: "break_sack",
  tackle: "tackle", powerMoves: "power_moves", finesseMoves: "finesse_moves", blockShedding: "block_shedding", pursuit: "pursuit",
  playRecognition: "play_recognition", manCoverage: "man_coverage", zoneCoverage: "zone_coverage", hitPower: "hit_power", press: "press",
  runBlock: "run_block", passBlock: "pass_block", impactBlocking: "impact_blocking",
  runBlockPower: "run_block_power", runBlockFinesse: "run_block_finesse", passBlockPower: "pass_block_power", passBlockFinesse: "pass_block_finesse", leadBlock: "lead_block",
  kickPower: "kick_power", kickAccuracy: "kick_accuracy", kickReturn: "kick_return",
};
const ATTRIBUTE_COLUMNS = Object.values(EA_STAT_MAP);

const CSV_HEADER = [
  "ea_player_id", "name", "position", "position_full", "team_label", "team_id",
  "jersey", "age", "dob", "college", "handedness", "height_inches", "weight_lbs", "years_pro",
  "overall", "archetype", "avatar_url", "dev_trait", "abilities_json",
  ...ATTRIBUTE_COLUMNS,
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface NextData {
  props: {
    pageProps: {
      ratingsEntries?: { items?: Array<Record<string, any>> };
      ratingsFilters?: { playerAbilities?: Array<Record<string, any>> };
    };
  };
}

async function fetchPage(url: string): Promise<NextData> {
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!m) throw new Error("no __NEXT_DATA__ script in response");
      const data = JSON.parse(m[1]);
      if (data?.props?.pageProps) return data;
      throw new Error("pageProps missing");
    } catch (err) {
      lastErr = String(err instanceof Error ? err.message : err);
      if (attempt < 4) await sleep(1500 * attempt + Math.random() * 800);
    }
  }
  throw new Error(`fetch failed after 4 attempts for ${url}: ${lastErr}`);
}

function parseBirthdate(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return raw;
  const yy = Number(m[3]);
  const year = 2000 + yy;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

type DevTrait = "normal" | "star" | "superstar" | "xfactor";

function deriveDevTrait(abilities: Array<Record<string, any>>): DevTrait {
  if (abilities.some((a) => String(a?.type?.id ?? "").toLowerCase() === "xfactor")) return "xfactor";
  if (abilities.length > 0) return "superstar";
  return "normal";
}

interface CompactPlayer {
  [key: string]: string;
}

function toCompactPlayer(item: Record<string, any>): CompactPlayer {
  const stats = (item.stats ?? {}) as Record<string, { value?: unknown; diff?: unknown }>;
  const abilities = (item.playerAbilities ?? []) as Array<Record<string, any>>;
  const devTrait = deriveDevTrait(abilities);
  const abilitiesJson = JSON.stringify(
    abilities.map((a) => ({ id: a.id ?? "", label: a.label ?? "", type: a?.type?.id ?? "" })),
  );
  const row: CompactPlayer = {
    ea_player_id: String(item.id ?? ""),
    name: [item.firstName ?? "", item.lastName ?? ""].filter(Boolean).join(" ").trim(),
    position: item.position?.id ?? "",
    position_full: item.position?.label ?? "",
    team_label: item.team?.label ?? "",
    team_id: String(item.team?.id ?? ""),
    jersey: item.jerseyNum == null ? "" : String(item.jerseyNum),
    age: item.age == null ? "" : String(item.age),
    dob: parseBirthdate(item.birthdate),
    college: item.college ?? "",
    handedness: item.handedness == null ? "" : String(item.handedness),
    height_inches: item.height == null ? "" : String(item.height),
    weight_lbs: item.weight == null ? "" : String(item.weight),
    years_pro: item.yearsPro == null ? "" : String(item.yearsPro),
    overall: item.overallRating == null ? "" : String(item.overallRating),
    archetype: item.archetype?.label ?? "",
    avatar_url: item.avatarUrl ?? "",
    dev_trait: devTrait,
    abilities_json: abilitiesJson,
  };
  for (const [eaKey, dbCol] of Object.entries(EA_STAT_MAP)) {
    const v = stats[eaKey]?.value;
    row[dbCol] = v == null ? "" : String(v);
  }
  return row;
}

function toCsv(rows: CompactPlayer[]): string {
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [
    CSV_HEADER.map((h) => escape(h)).join(","),
    ...rows.map((r) => CSV_HEADER.map((h) => escape(r[h] ?? "")).join(",")),
  ].join("\n") + "\n";
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

async function scrapeTeam(team: { id: number; slug: string; label: string }): Promise<CompactPlayer[]> {
  const rawPath = join(RAW_DIR, `${team.slug}.json`);
  if (existsSync(rawPath)) {
    const cached = JSON.parse(readFileSync(rawPath, "utf8")) as Array<Record<string, any>>;
    return cached.map(toCompactPlayer);
  }
  const url = `${BASE}/teams-ratings/${team.slug}/${team.id}`;
  const data = await fetchPage(url);
  const items = data.props.pageProps.ratingsEntries?.items ?? [];
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(rawPath, JSON.stringify(items));
  console.log(`  ${team.label}: ${items.length} players`);
  return items.map(toCompactPlayer);
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // 1. Ability catalog (index page) — descriptions feed the tooltips on the players page.
  const indexData = await fetchPage(BASE);
  const catalog = (indexData.props.pageProps.ratingsFilters?.playerAbilities ?? []).map((a) => ({
    id: a.id ?? "",
    label: a.label ?? "",
    description: a.description ?? "",
    type: { id: a.type?.id ?? "", label: a.type?.label ?? "" },
  }));
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`Saved ability catalog: ${catalog.length} abilities -> ${CATALOG_PATH}`);
  console.log("Distinct ability types:", [...new Set(catalog.map((a) => a.type.id))].join(", "));

  // 2. Team pages.
  const all: CompactPlayer[] = [];
  const CONCURRENCY = 3;
  let next = 0;
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < TEAMS.length) {
        const team = TEAMS[next++];
        try {
          all.push(...(await scrapeTeam(team)));
        } catch (err) {
          console.error(`  FAILED ${team.label}: ${String(err)}`);
        }
      }
    }),
  );
  void results;

  console.log(`Total EA players scraped: ${all.length}`);

  // Merge with any previously-scraped rows so the CSV is stable across partial runs.
  const seen = new Set<string>();
  const merged: CompactPlayer[] = [];
  for (const row of [...all, ...(existsSync(PLAYERS_CSV) ? parseCsv(readFileSync(PLAYERS_CSV, "utf8")) : [])]) {
    if (!row.ea_player_id || seen.has(row.ea_player_id)) continue;
    seen.add(row.ea_player_id);
    merged.push(row);
  }
  writeFileSync(PLAYERS_CSV, toCsv(merged));
  console.log(`Wrote ${merged.length} players -> ${PLAYERS_CSV}`);

  const byTrait: Record<string, number> = {};
  for (const row of merged) byTrait[row.dev_trait] = (byTrait[row.dev_trait] ?? 0) + 1;
  console.log("Dev-trait distribution:", Object.entries(byTrait).map(([k, v]) => `${k}=${v}`).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
