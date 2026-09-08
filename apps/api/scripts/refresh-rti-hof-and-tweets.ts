// Re-render HOF milestone Discord cards and regenerate weekly recap tweets from the
// currently imported week. Safe to re-run: recap pending rows are cleared then rebuilt,
// and HOF cards are edited in place.
import WebSocket from "ws";

if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

const { supabase } = await import("../src/lib/supabase.js");
const { refreshHofMilestonesAfterImport } = await import("../src/modules/immortality/hof-milestones.service.js");
const { queueImmortalityTweetsAfterImport } = await import("../src/modules/immortality/tweet-generation.service.js");

const leagues = await supabase.from("rec_immortality_leagues").select("league_id");
if (leagues.error) throw leagues.error;
for (const row of leagues.data ?? []) {
  const leagueId = String(row.league_id);
  await queueImmortalityTweetsAfterImport(leagueId);
  await refreshHofMilestonesAfterImport(leagueId);
  console.log(`Refreshed RTI HOF cards and recap tweets for ${leagueId}`);
}
process.exit(0);
