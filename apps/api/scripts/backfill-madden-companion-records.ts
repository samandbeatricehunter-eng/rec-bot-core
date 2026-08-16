// One-off backfill: madden_companion_import was missing from OFFICIAL_RESULT_SOURCES,
// so every Madden league's EA-imported games were silently excluded from
// season/league/global official records (rec_season_user_records,
// rec_global_user_records, rec_global_user_game_records) and from the display-records
// table. Rebuilds both for every league that has at least one madden_companion_import
// game result. Safe to re-run.
//
//   pnpm --filter @rec/api exec tsx scripts/backfill-madden-companion-records.ts
import { supabase } from "../src/lib/supabase.js";
import { rebuildOfficialRecordsAfterBoxScore } from "../src/modules/official-records/official-records.service.js";
import { rebuildSeasonDisplayRecords } from "../src/modules/display-records/display-records.service.js";

async function main() {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("league_id,season_number")
    .eq("source", "madden_companion_import");
  if (error) throw error;

  const leagueSeasons = new Map<string, Set<number>>();
  for (const row of data ?? []) {
    const set = leagueSeasons.get(row.league_id as string) ?? new Set<number>();
    set.add(row.season_number as number);
    leagueSeasons.set(row.league_id as string, set);
  }

  let ok = 0;
  let failed = 0;
  for (const [leagueId, seasons] of leagueSeasons) {
    for (const seasonNumber of seasons) {
      try {
        await rebuildOfficialRecordsAfterBoxScore({ leagueId, seasonNumber });
        await rebuildSeasonDisplayRecords(leagueId, seasonNumber);
        ok++;
        console.log(`OK league=${leagueId} season=${seasonNumber}`);
      } catch (e) {
        failed++;
        console.error(`FAIL league=${leagueId} season=${seasonNumber}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  console.log(`Backfill complete: ${ok} ok, ${failed} failed of ${leagueSeasons.size} leagues.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
