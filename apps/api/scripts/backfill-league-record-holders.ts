// One-off backfill: refreshLeagueRecordHolders only started running on new imports/box-score
// approvals going forward — leagues with data already imported before this shipped had no
// rec_league_record_holders rows at all. Runs the same refresh for every league that has at
// least one rec_player_weekly_stats row. Safe to re-run.
//
//   pnpm --filter @rec/api exec tsx scripts/backfill-league-record-holders.ts
import { supabase } from "../src/lib/supabase.js";
import { refreshLeagueRecordHolders } from "../src/modules/league-records/league-records.service.js";

async function main() {
  const { data, error } = await supabase.from("rec_player_weekly_stats").select("league_id");
  if (error) throw error;

  const leagueIds = [...new Set((data ?? []).map((row) => row.league_id as string))];
  let ok = 0;
  let failed = 0;
  for (const leagueId of leagueIds) {
    try {
      await refreshLeagueRecordHolders(leagueId);
      ok++;
      console.log(`OK league=${leagueId}`);
    } catch (e) {
      failed++;
      console.error(`FAIL league=${leagueId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`Backfill complete: ${ok} ok, ${failed} failed of ${leagueIds.length} leagues.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
