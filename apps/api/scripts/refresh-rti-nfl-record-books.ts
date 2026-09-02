// One-time/re-runnable operations script: replace frozen NFL baseline rows with the current
// authoritative shared dataset, preserve any RTI league-player entries, and post each board
// to the league's assigned record-holders channel.
import WebSocket from "ws";

// The operations workstation may still run Node 20, which has no native WebSocket.
// Supabase initializes Realtime even though this script only uses REST queries.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

const { supabase } = await import("../src/lib/supabase.js");
const { ensureNflRecordBaselinePosted } = await import("../src/modules/immortality/nfl-record-holders.service.js");

const leagues = await supabase.from("rec_immortality_leagues").select("league_id");
if (leagues.error) throw leagues.error;
for (const row of leagues.data ?? []) {
  const leagueId = String(row.league_id);
  await ensureNflRecordBaselinePosted(leagueId, { refreshAuthoritativeBaseline: true });
  console.log(`Refreshed RTI NFL record books for ${leagueId}`);
}
