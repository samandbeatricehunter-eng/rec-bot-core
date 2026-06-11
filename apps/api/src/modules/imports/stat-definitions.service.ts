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

// Scans stored weekly stats for a league and reports raw stat keys that do not map to any canonical
// REC stat, so the canonical map can be expanded. Backs GET /v1/imports/unmapped-stat-keys.
export async function getUnmappedStatKeys(leagueId: string, maxPages = 20): Promise<{ leagueId: string; scannedRows: number; truncated: boolean; unmapped: UnmappedEntry[] }> {
  const PAGE = 1000;
  const acc = new Map<string, UnmappedEntry>();
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
        const result = normalizeImportedStats({
          scope,
          statCategory: (row as any).stat_category,
          stats: (row as any).stats ?? {}
        });
        for (const [key, value] of Object.entries(result.unmappedStats)) {
          const compoundKey = `${(row as any).stat_category ?? "general"}::${key}`;
          const existing = acc.get(compoundKey);
          if (existing) {
            existing.count++;
          } else {
            acc.set(compoundKey, {
              key,
              count: 1,
              statCategory: (row as any).stat_category ?? "general",
              exampleValue: value,
              importJobId: (row as any).import_job_id ?? null
            });
          }
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

  const unmapped = [...acc.values()].sort((a, b) => b.count - a.count);
  return { leagueId, scannedRows, truncated, unmapped };
}
