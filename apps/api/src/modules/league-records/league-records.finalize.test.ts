import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importedStatsNeedFinalize } from "./league-records.finalize.js";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("importedStatsNeedFinalize is true for weekly stats and schedule, not snapshot datasets", () => {
  assert.equal(importedStatsNeedFinalize(["teams", "rosters"]), false);
  assert.equal(importedStatsNeedFinalize(["player_stats"]), true);
  assert.equal(importedStatsNeedFinalize(["team_stats"]), true);
  assert.equal(importedStatsNeedFinalize(["schedule"]), true);
  assert.equal(importedStatsNeedFinalize(["teams", "player_stats"]), true);
});

test("record-holding bonuses pay only at EOS, after holders refresh, never on import", () => {
  const eos = readFileSync(join(apiRoot, "modules/league-week/eos-payouts.service.ts"), "utf8");
  const ea = readFileSync(join(apiRoot, "modules/madden-ea/ea-connections.service.ts"), "utf8");
  const companion = readFileSync(join(apiRoot, "modules/madden-companion/madden-companion.service.ts"), "utf8");
  const holders = readFileSync(join(apiRoot, "modules/league-records/league-records.service.ts"), "utf8");

  const refreshAt = eos.indexOf("refreshLeagueRecordHolders");
  const payAt = eos.indexOf("payLeagueRecordHoldingBonuses");
  assert.ok(refreshAt >= 0, "EOS must refresh record holders before paying");
  assert.ok(payAt >= 0, "EOS must pay current record holders");
  assert.ok(refreshAt < payAt, "holders refresh must run before the EOS bonus payout");

  assert.equal(ea.includes("payLeagueRecordHoldingBonuses"), false);
  assert.equal(companion.includes("payLeagueRecordHoldingBonuses"), false);
  assert.ok(ea.includes("finalizeImportedLeagueStats"));
  assert.ok(companion.includes("finalizeImportedLeagueStats"));
  assert.ok(holders.includes("where excluded.value > rec_league_record_holders.value"));
});
