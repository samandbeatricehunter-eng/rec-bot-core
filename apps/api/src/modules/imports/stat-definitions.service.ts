import { STAT_DEFINITIONS, normalizeImportedStats, type StatUsage } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

const ALL_USAGES: StatUsage[] = [
  "import_preview", "weekly_menu", "game_channel", "challenge", "badge", "award", "eos_payout", "leaderboard"
];

// Full canonical definition catalog + usage groupings. Backs GET /v1/imports/stat-definitions.
export function getStatDefinitionsCatalog() {
  const usageGroups: Record<string, string[]> = {};
  for (const usage of ALL_USAGES) {
    usageGroups[usage] = STAT_DEFINITIONS.filter((d) => d.usedFor.includes(usage)).map((d) => d.canonicalKey);
  }
  const categoryGroups: Record<string, string[]> = {};
  for (const def of STAT_DEFINITIONS) {
    (categoryGroups[def.category] ??= []).push(def.canonicalKey);
  }
  return {
    count: STAT_DEFINITIONS.length,
    definitions: STAT_DEFINITIONS,
    usageGroups,
    categoryGroups
  };
}

interface UnmappedEntry {
  key: string;
  count: number;
  statCategory: string;
  exampleValue: unknown;
  importJobId: string | null;
}

type FieldMapEntry = {
  scope: "player" | "team";
  table: string;
  statCategory: string;
  rawKey: string;
  count: number;
  exampleValue: unknown;
  canonicalKey: string | null;
  friendlyName: string | null;
  category: string | null;
  usedFor: StatUsage[];
  importJobId: string | null;
  mapped: boolean;
};

function findCanonicalForRawKey(scope: "player" | "team", statCategory: string, rawKey: string) {
  const result = normalizeImportedStats({
    scope,
    statCategory,
    stats: { [rawKey]: 1 }
  });
  const [canonicalKey] = Object.keys(result.normalizedStats ?? {});
  if (!canonicalKey) return null;
  const definition = STAT_DEFINITIONS.find((def) => def.canonicalKey === canonicalKey) ?? null;
  return { canonicalKey, definition };
}

// Scans stored weekly stat rows and returns every raw stat key currently seen for a league,
// along with its canonical REC key/label when the stat normalizer already maps it.
export async function getImportFieldMap(leagueId: string, maxPages = 20): Promise<{ leagueId: string; scannedRows: number; truncated: boolean; fields: FieldMapEntry[] }> {
  const PAGE = 1000;
  const acc = new Map<string, FieldMapEntry>();
  let scannedRows = 0;
  let truncated = false;

  const scanTable = async (table: string, scope: "player" | "team") => {
    let from = 0;
    let page = 0;
    while (page < maxPages) {
      const { data, error } = await supabase
        .from(table)
        .select("stat_category,stats,import_job_id")
        .eq("league_id", leagueId)
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;

      for (const row of data) {
        scannedRows++;
        const statCategory = (row as any).stat_category ?? "general";
        const stats = ((row as any).stats ?? {}) as Record<string, unknown>;
        for (const [rawKey, exampleValue] of Object.entries(stats)) {
          const compoundKey = `${scope}::${statCategory}::${rawKey}`;
          const existing = acc.get(compoundKey);
          if (existing) {
            existing.count++;
            continue;
          }

          const canonical = findCanonicalForRawKey(scope, statCategory, rawKey);
          acc.set(compoundKey, {
            scope,
            table,
            statCategory,
            rawKey,
            count: 1,
            exampleValue,
            canonicalKey: canonical?.canonicalKey ?? null,
            friendlyName: canonical?.definition?.label ?? null,
            category: canonical?.definition?.category ?? null,
            usedFor: canonical?.definition?.usedFor ?? [],
            importJobId: (row as any).import_job_id ?? null,
            mapped: Boolean(canonical?.canonicalKey)
          });
        }
      }

      if (data.length < PAGE) break;
      from += PAGE;
      page++;
      if (page >= maxPages) truncated = true;
    }
  };

  await scanTable("rec_player_weekly_stats", "player");
  await scanTable("rec_team_weekly_stats", "team");

  const fields = [...acc.values()].sort((a, b) =>
    a.scope.localeCompare(b.scope) ||
    a.statCategory.localeCompare(b.statCategory) ||
    a.rawKey.localeCompare(b.rawKey)
  );

  return { leagueId, scannedRows, truncated, fields };
}

// Scans stored weekly stats for a league and reports raw stat keys that do not map to any canonical
// REC stat, so the canonical map can be expanded. Backs GET /v1/imports/unmapped-stat-keys.
export async function getUnmappedStatKeys(leagueId: string, maxPages = 20): Promise<{ leagueId: string; scannedRows: number; truncated: boolean; unmapped: UnmappedEntry[] }> {
  const fieldMap = await getImportFieldMap(leagueId, maxPages);
  const unmapped = fieldMap.fields
    .filter((field) => !field.mapped)
    .map((field) => ({
      key: field.rawKey,
      count: field.count,
      statCategory: field.statCategory,
      exampleValue: field.exampleValue,
      importJobId: field.importJobId
    }))
    .sort((a, b) => b.count - a.count);

  return { leagueId, scannedRows: fieldMap.scannedRows, truncated: fieldMap.truncated, unmapped };
}
