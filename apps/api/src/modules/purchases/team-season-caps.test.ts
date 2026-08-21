import assert from "node:assert/strict";
import test from "node:test";
import { countTeamLegendSlots, purchaseBelongsToTeam } from "./team-season-caps.js";

const CHARGERS = "team-chargers";
const OTHER = "team-other";

test("purchaseBelongsToTeam matches team_id or details.purchasingTeamId", () => {
  assert.equal(purchaseBelongsToTeam({ team_id: CHARGERS, details: {} }, CHARGERS), true);
  assert.equal(purchaseBelongsToTeam({ team_id: null, details: { purchasingTeamId: CHARGERS } }, CHARGERS), true);
  assert.equal(purchaseBelongsToTeam({ team_id: null, details: { teamId: CHARGERS } }, CHARGERS), true);
  assert.equal(purchaseBelongsToTeam({ team_id: OTHER, details: { purchasingTeamId: OTHER } }, CHARGERS), false);
});

test("countTeamLegendSlots counts a previous owner's fulfilled legend plus the new owner's pending one", () => {
  const used = countTeamLegendSlots({
    teamId: CHARGERS,
    purchases: [
      { team_id: null, details: { legendId: "cam", name: "Cam Newton", purchasingTeamId: CHARGERS } },
      { team_id: null, details: { legendId: "seau", name: "Junior Seau", purchasingTeamId: CHARGERS } },
    ],
    rosterLegends: [{ full_name: "Cam Newton", raw_payload: { legendId: "cam" } }],
  });
  assert.equal(used, 2);
});

test("countTeamLegendSlots does not double-count a roster legend that already has a purchase", () => {
  const used = countTeamLegendSlots({
    teamId: CHARGERS,
    purchases: [{ team_id: CHARGERS, details: { legendId: "cam", name: "Cam Newton" } }],
    rosterLegends: [{ full_name: "Cam Newton", raw_payload: { legendId: "cam" } }],
  });
  assert.equal(used, 1);
});

test("countTeamLegendSlots includes a roster legend with no matching purchase", () => {
  const used = countTeamLegendSlots({
    teamId: CHARGERS,
    purchases: [{ team_id: CHARGERS, details: { legendId: "seau", name: "Junior Seau" } }],
    rosterLegends: [{ full_name: "Cam Newton", raw_payload: {} }],
  });
  assert.equal(used, 2);
});

test("countTeamLegendSlots ignores purchases for a different team", () => {
  const used = countTeamLegendSlots({
    teamId: CHARGERS,
    purchases: [{ team_id: null, details: { legendId: "cam", name: "Cam Newton", purchasingTeamId: OTHER } }],
    rosterLegends: [],
  });
  assert.equal(used, 0);
});
