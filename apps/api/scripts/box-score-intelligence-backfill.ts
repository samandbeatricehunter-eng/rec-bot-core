// Backfill the box-score intelligence tables (profiles, stories, badges, events)
// for every already-approved box score. Idempotent and re-import-safe — re-running
// recomputes from the stored rec_team_game_stats rows and only writes the four
// engine tables, so it never affects payouts, results, or stat rollups.
//
//   pnpm --filter @rec/api exec tsx scripts/box-score-intelligence-backfill.ts
import { supabase } from "../src/lib/supabase.js";
import {
  CAREER_BADGES,
  GAME_BADGES,
  SEASON_BADGES,
} from "../src/modules/box-score-intelligence/badge-rules.js";
import {
  issueSeasonTotalBadges,
  processGameIntelligence,
} from "../src/modules/box-score-intelligence/persistence.js";

async function main() {
  const clearedEvents = await supabase.from("rec_badge_events").delete().not("id", "is", null);
  if (clearedEvents.error) throw clearedEvents.error;
  const clearedOwnership = await supabase.from("rec_badge_ownership").delete().not("id", "is", null);
  if (clearedOwnership.error) throw clearedOwnership.error;
  const clearedCatalog = await supabase.from("rec_badge_catalog").delete().eq("mode", "dynasty");
  if (clearedCatalog.error) throw clearedCatalog.error;

  const catalog = [
    ...GAME_BADGES.map((badge, index) => ({ ...badge, scope: "game", index })),
    ...SEASON_BADGES.map((badge, index) => ({ ...badge, scope: "season", index })),
    ...CAREER_BADGES.map((badge, index) => ({ ...badge, scope: "career", index })),
  ].flatMap((badge) =>
    (badge.games?.length ? badge.games : ["madden_26", "madden_27", "cfb_27"]).map((game) => ({
      badge_key: badge.key,
      game,
      mode: "dynasty",
      scope: badge.scope,
      category: badge.scope,
      label: badge.label,
      description: badge.description,
      active_qualifier: ["winning_tradition", "elite_standard", "juggernaut"].includes(badge.key),
      sort_order: badge.index,
    })),
  );
  const catalogUpsert = await supabase
    .from("rec_badge_catalog")
    .upsert(catalog, { onConflict: "badge_key,game,mode" });
  if (catalogUpsert.error) throw catalogUpsert.error;

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
  const { data: leagues, error: leagueError } = await supabase
    .from("rec_leagues")
    .select("id,season_number,display_season_number,season_stage");
  if (leagueError) throw leagueError;
  const ended = new Set(
    (subs ?? []).map((sub) => `${sub.league_id}:${sub.season_number}`),
  );
  for (const key of ended) {
    const [leagueId, rawSeason] = key.split(":");
    const season = Number(rawSeason);
    const league = (leagues ?? []).find((row) => row.id === leagueId);
    const currentSeason = Number(league?.season_number ?? league?.display_season_number ?? 1);
    const currentIsOffseason = String(league?.season_stage ?? "").startsWith("offseason");
    if (season < currentSeason || (season === currentSeason && currentIsOffseason)) {
      await issueSeasonTotalBadges(leagueId, season);
    }
  }
  console.log(`Backfill complete: ${ok} ok, ${failed} failed of ${subs?.length ?? 0} approved submissions.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
