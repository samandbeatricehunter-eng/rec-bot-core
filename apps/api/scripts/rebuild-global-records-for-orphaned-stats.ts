// One-off: rebuildOfficialGlobalRecords() only reads rec_game_results, so the 170
// rec_team_game_stats rows orphaned by a league hard-deleted before
// preserveGlobalContributionsBeforeLeagueDelete existed (live since 2026-07-29) were never
// picked up by any global record rebuild. loadOrphanedGameResults() (added in
// official-records.service.ts) now recovers them; this runs the rebuild for exactly the
// affected users so their global W/L/points reflect it. Safe to re-run.
//
//   pnpm --filter @rec/api exec tsx scripts/rebuild-global-records-for-orphaned-stats.ts
import { supabase } from "../src/lib/supabase.js";
import { rebuildOfficialGlobalRecords } from "../src/modules/official-records/official-records.service.js";

async function main() {
  const { data, error } = await supabase
    .from("rec_team_game_stats")
    .select("game_id,league_id,user_id")
    .not("game_id", "is", null)
    .not("user_id", "is", null);
  if (error) throw error;
  const rows = data ?? [];

  const leagueIds = [...new Set(rows.map((row) => String(row.league_id)))];
  const { data: liveLeagues, error: leagueError } = await supabase.from("rec_leagues").select("id").in("id", leagueIds);
  if (leagueError) throw leagueError;
  const liveLeagueIds = new Set((liveLeagues ?? []).map((row) => String(row.id)));

  const gameIds = [...new Set(rows.map((row) => String(row.game_id)))];
  const { data: liveGames, error: gameError } = await supabase.from("rec_games").select("id").in("id", gameIds);
  if (gameError) throw gameError;
  const liveGameIds = new Set((liveGames ?? []).map((row) => String(row.id)));

  const affectedUserIds = [
    ...new Set(
      rows
        .filter((row) => !liveLeagueIds.has(String(row.league_id)) || !liveGameIds.has(String(row.game_id)))
        .map((row) => String(row.user_id)),
    ),
  ];

  console.log(`Rebuilding global records for ${affectedUserIds.length} users affected by orphaned rec_team_game_stats:`, affectedUserIds);
  if (!affectedUserIds.length) return;

  const result = await rebuildOfficialGlobalRecords(affectedUserIds);
  console.log("Done:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
