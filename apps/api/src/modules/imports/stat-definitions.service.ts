import { STAT_DEFINITIONS, normalizeImportedStats, type StatUsage } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

const ALL_USAGES: StatUsage[] = [
  "import_preview", "weekly_menu", "game_channel", "challenge", "badge", "award", "eos_payout", "leaderboard"
];

const IMPORT_RAW_SOURCES: Array<{
  endpointKey: string;
  table: string;
  scope: "player" | "team" | "game" | "standing" | "roster" | "league";
  columns: Array<"raw_payload" | "normalized" | "stats">;
  statScope?: "player" | "team";
}> = [
  { endpointKey: "teams", table: "rec_import_staging_teams", scope: "team", columns: ["raw_payload", "normalized"] },
  { endpointKey: "standings", table: "rec_import_staging_standings", scope: "standing", columns: ["raw_payload", "normalized", "stats"] },
  { endpointKey: "weekly_stats", table: "rec_import_staging_games", scope: "game", columns: ["raw_payload", "normalized"] },
  { endpointKey: "rosters", table: "rec_import_staging_rosters", scope: "roster", columns: ["raw_payload", "normalized"] },
  { endpointKey: "weekly_stats", table: "rec_import_staging_player_stats", scope: "player", columns: ["raw_payload", "normalized", "stats"], statScope: "player" },
  { endpointKey: "weekly_stats", table: "rec_import_staging_team_stats", scope: "team", columns: ["raw_payload", "normalized", "stats"], statScope: "team" }
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
  endpointKey: string;
  scope: string;
  table: string;
  sourceColumn: "raw_payload" | "normalized" | "stats";
  statCategory: string | null;
  rawJsonPath: string;
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
  const [canonicalKey] = Object.keys(result.canonicalStats ?? {});
  if (!canonicalKey) return null;
  const definition = STAT_DEFINITIONS.find((def) => def.canonicalKey === canonicalKey) ?? null;
  return { canonicalKey, definition };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walkJsonFields(value: unknown, prefix = ""): Array<{ path: string; key: string; value: unknown }> {
  if (!isPlainObject(value)) return [];
  const fields: Array<{ path: string; key: string; value: unknown }> = [];

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    fields.push({ path, key, value: child });

    if (isPlainObject(child)) {
      fields.push(...walkJsonFields(child, path));
    } else if (Array.isArray(child)) {
      const sample = child.find((item) => item != null);
      if (isPlainObject(sample)) {
        fields.push(...walkJsonFields(sample, `${path}[]`));
      }
    }
  }

  return fields;
}

function mergeField(acc: Map<string, FieldMapEntry>, field: FieldMapEntry) {
  const compoundKey = [field.endpointKey, field.table, field.sourceColumn, field.statCategory ?? "", field.rawJsonPath].join("::");
  const existing = acc.get(compoundKey);
  if (existing) {
    existing.count++;
    return;
  }
  acc.set(compoundKey, field);
}

// Scans import staging rows and returns every raw JSON field currently seen for a league,
// including non-stat endpoint payloads. This is the raw EA field dictionary foundation.
export async function getImportFieldMap(leagueId: string, maxPages = 20): Promise<{ leagueId: string; scannedRows: number; truncated: boolean; fields: FieldMapEntry[] }> {
  const PAGE = 1000;
  const acc = new Map<string, FieldMapEntry>();
  let scannedRows = 0;
  let truncated = false;

  for (const source of IMPORT_RAW_SOURCES) {
    let from = 0;
    let page = 0;
    while (page < maxPages) {
      const selectColumns = ["import_job_id", "stat_category", ...source.columns].join(",");
      const { data, error } = await supabase
        .from(source.table)
        .select(selectColumns)
        .eq("league_id", leagueId)
        .range(from, from + PAGE - 1);

      if (error || !data?.length) break;

      for (const row of data) {
        scannedRows++;
        const statCategory = (row as any).stat_category ?? null;

        for (const sourceColumn of source.columns) {
          const payload = (row as any)[sourceColumn];
          const fields = walkJsonFields(payload);

          for (const item of fields) {
            const shouldTryStatMapping = Boolean(source.statScope && sourceColumn === "stats" && statCategory);
            const canonical = shouldTryStatMapping
              ? findCanonicalForRawKey(source.statScope!, String(statCategory), item.key)
              : null;

            mergeField(acc, {
              endpointKey: source.endpointKey,
              scope: source.scope,
              table: source.table,
              sourceColumn,
              statCategory,
              rawJsonPath: item.path,
              rawKey: item.key,
              count: 1,
              exampleValue: item.value,
              canonicalKey: canonical?.canonicalKey ?? null,
              friendlyName: canonical?.definition?.label ?? null,
              category: canonical?.definition?.category ?? null,
              usedFor: canonical?.definition?.usedFor ?? [],
              importJobId: (row as any).import_job_id ?? null,
              mapped: Boolean(canonical?.canonicalKey) || sourceColumn === "normalized"
            });
          }
        }
      }

      if (data.length < PAGE) break;
      from += PAGE;
      page++;
      if (page >= maxPages) truncated = true;
    }
  }

  const fields = [...acc.values()].sort((a, b) =>
    a.endpointKey.localeCompare(b.endpointKey) ||
    a.sourceColumn.localeCompare(b.sourceColumn) ||
    (a.statCategory ?? "").localeCompare(b.statCategory ?? "") ||
    a.rawJsonPath.localeCompare(b.rawJsonPath)
  );

  return { leagueId, scannedRows, truncated, fields };
}

// Scans stored weekly stats for a league and reports raw stat keys that do not map to any canonical
// REC stat, so the canonical map can be expanded. Backs GET /v1/imports/unmapped-stat-keys.
export async function getUnmappedStatKeys(leagueId: string, maxPages = 20): Promise<{ leagueId: string; scannedRows: number; truncated: boolean; unmapped: UnmappedEntry[] }> {
  const fieldMap = await getImportFieldMap(leagueId, maxPages);
  const unmapped = fieldMap.fields
    .filter((field) => field.sourceColumn === "stats" && !field.mapped)
    .map((field) => ({
      key: field.rawKey,
      count: field.count,
      statCategory: field.statCategory ?? "general",
      exampleValue: field.exampleValue,
      importJobId: field.importJobId
    }))
    .sort((a, b) => b.count - a.count);

  return { leagueId, scannedRows: fieldMap.scannedRows, truncated: fieldMap.truncated, unmapped };
}
