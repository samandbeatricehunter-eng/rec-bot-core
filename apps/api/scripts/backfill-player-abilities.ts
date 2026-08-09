// Backfills rec_players.abilities for Madden players seeded into leagues before the
// 20260814000000_add_abilities_to_rec_players migration. Parses the active baseline
// dataset's abilities_raw blobs (same parser applyMaddenBaselineToLeague uses) and PATCHes
// every matching rec_players row that still has a null abilities column. Idempotent — the
// `abilities=is.null` filter makes re-runs no-ops.
//
// Run: pnpm --filter @rec/api exec tsx scripts/backfill-player-abilities.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";
import { parseAbilitiesRaw } from "../src/modules/madden-baseline/abilities.js";

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
async function restPatch(table: string, query: string, patch: unknown): Promise<RestResult<null>> {
  const res = await fetch(`${REST_URL}/${table}?${query}`, { method: "PATCH", headers: restHeaders(), body: JSON.stringify(patch) });
  if (!res.ok) return { data: null, error: { message: `${res.status} ${await res.text()}` } };
  return { data: null, error: null };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function withRetry<T>(run: () => Promise<T>, label: string, attempts = 3): Promise<T> {
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

async function main() {
  const dataset = await withRetry(
    () => restSelect<Array<{ id: string }>>("rec_madden_roster_datasets", "select=id&game_title=eq.madden_27&is_active=eq.true&order=created_at.desc&limit=1"),
    "resolve active dataset",
  );
  const datasetId = dataset.data?.[0]?.id;
  if (!datasetId) throw new Error("No active Madden 27 baseline dataset found.");

  const pageSize = 1000;
  const baseline: Array<{ source_slug: string; abilities_raw: string | null }> = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await withRetry(
      () => restSelect<Array<{ source_slug: string; abilities_raw: string | null }>>(
        "rec_madden_baseline_players",
        `select=source_slug,abilities_raw&dataset_id=eq.${datasetId}&abilities_raw=not.is.null&order=source_slug.asc&offset=${offset}&limit=${pageSize}`,
      ),
      `load baseline abilities [${offset}]`,
    );
    if (error) throw new Error(error.message);
    baseline.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  console.log(`Loaded ${baseline.length} baseline players with abilities_raw.`);

  let updated = 0;
  let failed = 0;
  for (const entry of baseline) {
    const abilities = parseAbilitiesRaw(entry.abilities_raw);
    const playerId = `madden27:${entry.source_slug}`;
    const query = `madden_player_id=eq.${encodeURIComponent(playerId)}&abilities=is.null`;
    const { error } = await withRetry(
      () => restPatch("rec_players", query, { abilities, ability_count: abilities.length }),
      `update ${playerId}`,
    );
    if (error) { failed++; console.warn(`  failed ${playerId}: ${error.message}`); continue; }
    updated++;
  }
  console.log(`Backfilled ${updated} rec_players rows (${failed} failed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
