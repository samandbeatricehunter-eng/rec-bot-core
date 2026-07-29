import { getPgPool } from "../../db/client.js";
import { refreshAllPowerRankings } from "../rankings/rankings.service.js";
import { pruneDeadHighlightsOnceDaily, refreshSpotlightReel } from "../site-home/site-home.service.js";

type StageResult = { ok: true; result: unknown } | { ok: false; error: string };

async function stage(run: () => Promise<unknown>): Promise<StageResult> {
  try {
    return { ok: true, result: await run() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ERROR] daily maintenance stage failed:", error);
    return { ok: false, error: message };
  }
}

export async function runDailyMaintenance() {
  const client = await getPgPool().connect();
  const lockKey = 1_944_027_008;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [lockKey],
    );
    if (!lock.rows[0]?.locked) return { skipped: true, reason: "already_running" as const };
    const highlights = await stage(async () => ({
      pruned: await pruneDeadHighlightsOnceDaily(),
      spotlight: await refreshSpotlightReel(),
    }));
    const rankings = await stage(() => refreshAllPowerRankings());
    return { skipped: false, ranAt: new Date().toISOString(), stages: { highlights, rankings } };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    client.release();
  }
}
