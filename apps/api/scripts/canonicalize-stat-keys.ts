// One-off backfill: rec_player_weekly_stats.stats was stored under EA's raw field names
// (passYds, defSacks, puntAtt, …) instead of the canonical keys every downstream reader
// (League Stats, League Records, season/career totals, badges) actually looks up by — the
// STAT_DEFINITIONS[].aliases list existed for exactly this translation but had no consumer.
// Re-keys every already-imported row in place. Safe to re-run (idempotent — canonicalizing an
// already-canonical payload is a no-op).
//
//   pnpm --filter @rec/api exec tsx scripts/canonicalize-stat-keys.ts
import { canonicalizeStatPayload } from "@rec/shared";
import { supabase } from "../src/lib/supabase.js";

async function main() {
  let offset = 0;
  const pageSize = 500;
  let updated = 0;
  let unchanged = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("rec_player_weekly_stats")
      .select("id,stats")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const raw = (row.stats ?? {}) as Record<string, number>;
      const canonical = canonicalizeStatPayload(raw);
      const changed = JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(Object.keys(canonical).sort())
        || Object.entries(canonical).some(([key, value]) => raw[key] !== value);
      if (!changed) { unchanged++; continue; }
      const { error: updateError } = await supabase.from("rec_player_weekly_stats").update({ stats: canonical }).eq("id", row.id);
      if (updateError) { console.error(`FAIL id=${row.id}: ${updateError.message}`); continue; }
      updated++;
    }

    offset += pageSize;
    console.log(`...processed ${offset}, updated ${updated}, unchanged ${unchanged}`);
  }

  console.log(`Done. Updated ${updated}, unchanged ${unchanged}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
