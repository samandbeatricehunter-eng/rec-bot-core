// Backfill the box-score intelligence tables (profiles, stories, badges, events)
// for every already-approved box score. Idempotent and re-import-safe — re-running
// recomputes from the stored rec_team_game_stats rows and only writes the four
// engine tables, so it never affects payouts, results, or stat rollups.
//
//   pnpm --filter @rec/api exec tsx scripts/box-score-intelligence-backfill.ts
import { supabase } from "../src/lib/supabase.js";
import { processGameIntelligence } from "../src/modules/box-score-intelligence/persistence.js";

async function main() {
  const { data: subs, error } = await supabase
    .from("rec_box_score_submissions")
    .select("id,league_id,season_number,week_number,game_id")
    .eq("status", "approved")
    .order("season_number", { ascending: true })
    .order("week_number", { ascending: true });
  if (error) throw error;

  let ok = 0;
  let failed = 0;
  for (const sub of subs ?? []) {
    try {
      await processGameIntelligence(sub as Parameters<typeof processGameIntelligence>[0]);
      ok++;
    } catch (e) {
      failed++;
      console.error(`FAIL ${sub.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`Backfill complete: ${ok} ok, ${failed} failed of ${subs?.length ?? 0} approved submissions.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
