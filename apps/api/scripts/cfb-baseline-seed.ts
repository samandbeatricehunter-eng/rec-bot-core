// CFB 27 baseline roster seed — Editorial & Import Master Plan §5.
//
// Fetches the complete CFB 27 player roster from CFB Labs (the `cfb27-players` GraphQL-over-GET
// endpoint) and populates the baseline tables:
//   rec_cfb_roster_datasets            (one approved, active, versioned dataset)
//   rec_cfb_baseline_teams             (provider teams normalized to the CFB_27_TEAMS catalog)
//   rec_cfb_baseline_players           (all ~11.7k players)
//   rec_cfb_baseline_player_attributes (per-attribute rows for the full rating set)
//   rec_cfb_baseline_source_records    (immutable raw payloads + hashes for audit/reconciliation)
//
// Data path: the Supabase REST API via the service-role key (the pg pool path depends on
// REC_DATABASE_URL, which is not required here). Idempotent — re-running wipes the dataset
// with the same (game_title, provider, published_date, source_version) identity and re-seeds.
//
// Run: pnpm --filter @rec/api exec tsx scripts/cfb-baseline-seed.ts
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CFB_27_TEAMS, CFB_TEAM_PRIMARY_COLORS, type CfbTeamOption } from "@rec/shared";
import { env } from "../src/config/env.js";

const PLAYERS_URL = "https://www.cfblabs.com/.netlify/functions/cfb27-players";
const PAGE_LIMIT = 2000;
const GAME_TITLE = "cfb_27";
const PROVIDER = "cfblabs.com";

type ProviderPlayer = {
  id: number;
  first_name: string;
  last_name: string;
  position: string | null;
  number: number | null;
  height: number | null;
  weight: number | null;
  tendency?: string | null;
  class: string | null;
  hometown: string | null;
  team: string;
  physicals?: string[] | null;
  mentals?: string[] | null;
  utility?: string | null;
  roster_date?: string | null;
  OVR?: number | null;
  [attribute: string]: unknown;
};

// Every numeric rating the provider exposes, in a stable order. Lowercased keys are stored in
// rec_cfb_baseline_player_attributes; source_field keeps the provider's original field name.
const NUMERIC_ATTRIBUTE_FIELDS = [
  "SPD", "STR", "AGI", "ACC", "AWR", "BTK", "TRK", "COD", "BCV", "SFA", "SPM", "JKM", "CAR",
  "CTH", "SRR", "MRR", "DRR", "CIT", "SPC", "RLS", "JMP", "THP", "SAC", "MAC", "DAC", "RUN",
  "TUP", "BSK", "PAC", "TAK", "POW", "PMV", "FMV", "BSH", "PUR", "PRC", "MCV", "ZCV", "PRS",
  "PBK", "PBP", "PBF", "RBK", "RBP", "RBF", "LBK", "IBL", "KPW", "KAC", "RET", "STA", "INJ",
  "TGH", "LSN", "OVR",
];

// Provider team spellings that don't match CFB_27_TEAMS name/abbreviation verbatim.
const PROVIDER_TEAM_ALIASES: Record<string, string> = {
  "HAWAII": "Hawai'i",
  "PITTSBURGH": "Pitt",
  "MID TENN STATE": "Middle Tennessee",
  "NC STATE": "NC State",
  "NEW MEXICO ST.": "New Mexico State",
  "FLORIDA INTERNATIONAL": "FIU",
  "UL MONROE": "ULM",
  "MIAMI [OH]": "Miami (OH)",
  "MIAMI (OH)": "Miami (OH)",
  "SAM HOUSTON STATE": "Sam Houston",
};

const CLASS_YEAR: Record<string, string> = {
  FRESHMAN: "FR",
  SOPHOMORE: "SO",
  JUNIOR: "JR",
  SENIOR: "SR",
};

const BASE_QUERY_FIELDS = [
  "id", "first_name", "last_name", "position", "number", "height", "weight", "tendency",
  "class", "hometown", "team", "physicals", "mentals", "utility", "roster_date",
  ...NUMERIC_ATTRIBUTE_FIELDS,
].join(" ");

function checksumOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry a Supabase query a few times — right after a large insert burst PostgREST/PG can
// transiently time out a statement that runs fine on its own.
async function withRetry<T extends { error: { message: string } | null }>(
  run: () => Promise<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await run();
    if (!res.error) return res;
    lastError = res.error.message;
    console.warn(`  ${label} failed (attempt ${attempt}/${attempts}): ${lastError}`);
    if (attempt < attempts) await sleep(5000 * attempt);
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError}`);
}

// Cascade delete from rec_cfb_roster_datasets times out (659k attributes in one statement
// exceeds Supabase's 30s statement_timeout), so clear child tables in small batches first.
async function clearDataset(client: SupabaseClient, datasetId: string): Promise<void> {
  await withRetry(
    () => client.from("rec_cfb_baseline_source_records").delete().eq("dataset_id", datasetId),
    "clear source records",
  );

  const batchSize = 100;
  let offset = 0;
  for (;;) {
    const page = await withRetry(
      () =>
        client
          .from("rec_cfb_baseline_players")
          .select("id")
          .eq("dataset_id", datasetId)
          .range(offset, offset + batchSize - 1),
      "page baseline players",
    );
    const ids = (page.data ?? []).map((p) => p.id as string);
    if (!ids.length) break;
    await withRetry(
      () => client.from("rec_cfb_baseline_player_attributes").delete().in("player_id", ids),
      "clear player attributes",
    );
    offset += ids.length;
    if (ids.length < batchSize) break;
  }

  await withRetry(
    () => client.from("rec_cfb_baseline_players").delete().eq("dataset_id", datasetId),
    "clear baseline players",
  );
  await withRetry(
    () => client.from("rec_cfb_baseline_teams").delete().eq("dataset_id", datasetId),
    "clear baseline teams",
  );
  await withRetry(
    () => client.from("rec_cfb_roster_datasets").delete().eq("id", datasetId),
    "clear dataset",
  );
}

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function mapClass(cls: string | null): string | null {
  if (!cls) return null;
  const upper = cls.trim().toUpperCase();
  if (CLASS_YEAR[upper]) return CLASS_YEAR[upper];
  if (upper.startsWith("GRAD")) return "GR";
  return null;
}

function splitHometown(hometown: string | null): { city: string | null; state: string | null } {
  if (!hometown) return { city: null, state: null };
  const idx = hometown.lastIndexOf(", ");
  if (idx === -1) return { city: hometown.trim(), state: null };
  return { city: hometown.slice(0, idx).trim(), state: hometown.slice(idx + 2).trim() };
}

async function fetchPlayers(): Promise<ProviderPlayer[]> {
  const players: ProviderPlayer[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const query = `query GetTeamPlayers($page: Int, $limit: Int) { teamPlayers(page: $page, limit: $limit) { players { ${BASE_QUERY_FIELDS} } totalCount totalPages currentPage } }`;
    const url = `${PLAYERS_URL}?query=${encodeURIComponent(query)}&variables=${encodeURIComponent(JSON.stringify({ page, limit: PAGE_LIMIT }))}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`CFB Labs fetch failed (page ${page}): HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: { teamPlayers?: { players?: ProviderPlayer[]; totalPages?: number; currentPage?: number } };
    };
    const tp = body.data?.teamPlayers;
    if (!tp?.players) throw new Error(`CFB Labs returned an unexpected payload on page ${page}.`);
    players.push(...tp.players);
    totalPages = tp.totalPages ?? 1;
    console.log(`  fetched page ${page}/${totalPages} (${tp.players.length} players)`);
    page += 1;
  } while (page <= totalPages);
  return players;
}

function resolveProviderTeam(providerTeam: string): CfbTeamOption | null {
  const key = providerTeam.trim().toUpperCase();
  const aliasTarget = PROVIDER_TEAM_ALIASES[key];
  if (aliasTarget) return CFB_27_TEAMS.find((t) => t.name === aliasTarget) ?? null;
  const byAbbreviation = CFB_27_TEAMS.find((t) => t.abbreviation.toUpperCase() === key);
  if (byAbbreviation) return byAbbreviation;
  return CFB_27_TEAMS.find((t) => t.name.toUpperCase() === key) ?? null;
}

async function insertBatched(
  client: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  batchSize: number,
  concurrency = 4,
): Promise<Array<Record<string, unknown>>> {
  if (!rows.length) return [];
  const chunks: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < rows.length; i += batchSize) chunks.push(rows.slice(i, i + batchSize));
  let index = 0;
  let failures = 0;
  const out: Array<Record<string, unknown>> = [];
  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
    while (index < chunks.length) {
      const chunk = chunks[index++];
      const { data, error } = await client.from(table).insert(chunk).select("*");
      if (error) {
        failures++;
        throw new Error(`Failed to insert ${table} (${chunk.length} rows): ${error.message}`);
      }
      if (data) out.push(...(data as Array<Record<string, unknown>>));
    }
  });
  await Promise.all(workers);
  if (failures) throw new Error(`Insert failed for ${table}.`);
  return out;
}

function buildAttributeRows(
  players: ProviderPlayer[],
  playerIdBySource: Map<string, string>,
): Array<{ player_id: string; attribute_key: string; attribute_value: unknown; source_field: string }> {
  const rows: Array<{ player_id: string; attribute_key: string; attribute_value: unknown; source_field: string }> = [];
  for (const player of players) {
    const playerId = playerIdBySource.get(String(player.id));
    if (!playerId) continue;
    for (const field of NUMERIC_ATTRIBUTE_FIELDS) {
      const value = player[field];
      if (value === null || value === undefined) continue;
      rows.push({ player_id: playerId, attribute_key: field.toLowerCase(), attribute_value: value, source_field: field });
    }
    if (player.physicals?.length) rows.push({ player_id: playerId, attribute_key: "physicals", attribute_value: player.physicals, source_field: "physicals" });
    if (player.mentals?.length) rows.push({ player_id: playerId, attribute_key: "mentals", attribute_value: player.mentals, source_field: "mentals" });
    if (player.utility) rows.push({ player_id: playerId, attribute_key: "utility", attribute_value: player.utility, source_field: "utility" });
  }
  return rows;
}

async function main() {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Fetching CFB 27 roster from CFB Labs...");
  const players = await fetchPlayers();
  if (!players.length) throw new Error("CFB Labs returned zero players.");
  console.log(`Fetched ${players.length} players.`);

  const unknownClasses = new Set<string>();
  const teamByProvider = new Map<string, CfbTeamOption>();
  const unmappedTeams = new Set<string>();
  for (const player of players) {
    const key = player.team.trim().toUpperCase();
    if (key && !teamByProvider.has(key)) {
      const team = resolveProviderTeam(player.team);
      if (team) teamByProvider.set(key, team);
      else unmappedTeams.add(key);
    }
    if (player.class) {
      const year = mapClass(player.class);
      if (!year) unknownClasses.add(player.class.trim().toUpperCase());
    }
  }

  if (unmappedTeams.size) {
    console.error(`Unmapped provider teams (${unmappedTeams.size}): ${[...unmappedTeams].sort().join(", ")}`);
    console.error("Update PROVIDER_TEAM_ALIASES / resolveProviderTeam in this script, then re-run.");
    process.exit(1);
  }
  if (unknownClasses.size) {
    console.warn(`Unknown class values (stored as null): ${[...unknownClasses].sort().join(", ")}`);
  }
  console.log(`Mapped ${teamByProvider.size} provider teams to the CFB 27 catalog.`);

  const rosterDates = [...new Set(players.map((p) => normalizeDate(p.roster_date)).filter((d): d is string => Boolean(d)))];
  const publishedDate = rosterDates[0];
  if (!publishedDate) throw new Error("Could not derive the dataset published_date from roster_date.");
  const sourceVersion = `cfb27-${publishedDate}`;
  const identity = {
    game_title: GAME_TITLE,
    provider: PROVIDER,
    published_date: publishedDate,
    source_version: sourceVersion,
  };

  const sortedForHash = [...players].sort((a, b) => a.id - b.id);
  const datasetChecksum = checksumOf(sortedForHash);

  const existing = await client.from("rec_cfb_roster_datasets").select("id").match(identity).maybeSingle();
  if (existing.error) throw new Error(`Failed to look up existing dataset: ${existing.error.message}`);
  if (existing.data) {
    await clearDataset(client, existing.data.id);
    console.log(`Cleared existing dataset ${existing.data.id} (source records, attributes, players, teams, dataset).`);
  }

  const inserted = await client
    .from("rec_cfb_roster_datasets")
    .insert({
      ...identity,
      checksum: datasetChecksum,
      attribution_config: {
        url: "https://www.cfblabs.com/cfb-roster",
        source: "CFB Labs",
        fetched_via: "cfb27-players GraphQL endpoint",
        roster_date: publishedDate,
      },
      legal_review_status: "approved",
      legal_review_notes: "Public reference roster; auto-approved as the versioned CFB 27 baseline dataset.",
      is_active: true,
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(`Failed to create dataset: ${inserted.error.message}`);
  const datasetId = (inserted.data as { id: string }).id;
  console.log(`Dataset ${datasetId} created (${players.length} players, checksum ${datasetChecksum.slice(0, 12)}...).`);

  const teamRows = [...teamByProvider.entries()].map(([providerName, team]) => ({
    dataset_id: datasetId,
    source_team_id: providerName,
    name: team.name,
    abbreviation: team.abbreviation,
    display_name: null,
    conference: team.conference,
    division: "FBS",
    color_primary: CFB_TEAM_PRIMARY_COLORS[team.abbreviation] ?? null,
    color_secondary: null,
    logo_url: null,
  }));
  const teamInsert = await client.from("rec_cfb_baseline_teams").insert(teamRows).select("id,source_team_id");
  if (teamInsert.error) throw new Error(`Failed to insert baseline teams: ${teamInsert.error.message}`);
  const teamIdByProvider = new Map((teamInsert.data ?? []).map((t) => [t.source_team_id as string, t.id as string]));
  console.log(`Inserted ${teamInsert.data?.length ?? 0} baseline teams.`);

  const playerRows = players.map((player) => {
    const providerKey = player.team.trim().toUpperCase();
    const hometown = splitHometown(player.hometown);
    return {
      dataset_id: datasetId,
      team_id: teamIdByProvider.get(providerKey) ?? null,
      source_player_id: String(player.id),
      first_name: player.first_name,
      last_name: player.last_name,
      jersey_number: player.number ?? null,
      position: player.position ?? null,
      year: mapClass(player.class),
      height_inches: player.height ?? null,
      weight_lbs: player.weight ?? null,
      hometown_city: hometown.city,
      hometown_state: hometown.state,
      overall_rating: typeof player.OVR === "number" ? player.OVR : null,
    };
  });
  const playerInserted = await insertBatched(client, "rec_cfb_baseline_players", playerRows, 500);
  const playerIdBySource = new Map<string, string>();
  for (const row of playerInserted) {
    playerIdBySource.set(row.source_player_id as string, row.id as string);
  }
  console.log(`Inserted ${playerInserted.length} baseline players.`);

  const attributeRows = buildAttributeRows(players, playerIdBySource);
  await insertBatched(client, "rec_cfb_baseline_player_attributes", attributeRows, 2000, 6);
  console.log(`Inserted ${attributeRows.length} player attribute rows.`);

  const sourceRows: Array<Record<string, unknown>> = [];
  for (const player of players) {
    sourceRows.push({
      dataset_id: datasetId,
      record_type: "player",
      source_id: String(player.id),
      raw_payload: player,
      record_hash: checksumOf(player),
    });
  }
  for (const [providerName, team] of teamByProvider) {
    const raw = { name: providerName, canonical_team: team.name, abbreviation: team.abbreviation, player_count: playerRows.filter((r) => r.team_id === teamIdByProvider.get(providerName)).length };
    sourceRows.push({
      dataset_id: datasetId,
      record_type: "team",
      source_id: providerName,
      raw_payload: raw,
      record_hash: checksumOf(raw),
    });
  }
  await insertBatched(client, "rec_cfb_baseline_source_records", sourceRows, 500);
  console.log(`Inserted ${sourceRows.length} source records.`);

  const verify = await withRetry(
    () =>
      client
        .from("rec_cfb_baseline_players")
        .select("id", { count: "exact", head: true })
        .eq("dataset_id", datasetId),
    "verify player count",
  );
  const teamCount = await withRetry(
    () => client.from("rec_cfb_baseline_teams").select("id", { count: "exact", head: true }).eq("dataset_id", datasetId),
    "verify team count",
  );
  // Attributes have no dataset_id column — count via the player relationship.
  const attrCount = await withRetry(
    () =>
      client
        .from("rec_cfb_baseline_player_attributes")
        .select("player_id!inner(dataset_id)", { count: "exact", head: true })
        .eq("player_id.dataset_id", datasetId),
    "verify attribute count",
  );
  if (verify.error || teamCount.error || attrCount.error) {
    const details = [
      ["players", verify],
      ["teams", teamCount],
      ["attributes", attrCount],
    ]
      .filter(([, q]) => q.error)
      .map(([name, q]) => `${name}: HTTP ${q.status} ${JSON.stringify(q.error)}`)
      .join("; ");
    throw new Error(`Verification queries failed (${details}).`);
  }
  console.log("=== SEED COMPLETE ===");
  console.log(`  dataset:      ${datasetId}`);
  console.log(`  teams:        ${teamCount.count ?? 0}`);
  console.log(`  players:      ${verify.count ?? 0}`);
  console.log(`  attributes:   ${attrCount.count ?? 0}`);
  console.log(`  source rows:  ${sourceRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
