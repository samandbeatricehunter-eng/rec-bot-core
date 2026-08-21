/** Companion / EA ingest endpoints whose canonical apply feeds matchup ranks, hub
 * power rankings, or rec_player_weekly_stats (the source for league record holders). */
const STATS_IMPORT_ENDPOINTS = new Set(["player_stats", "team_stats", "schedule"]);

export function importedStatsNeedFinalize(endpointKeys: Iterable<string>): boolean {
  for (const key of endpointKeys) {
    if (STATS_IMPORT_ENDPOINTS.has(key)) return true;
  }
  return false;
}
