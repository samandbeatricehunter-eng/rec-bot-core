import assert from "node:assert/strict";
import test from "node:test";
import { chunkItems, weeklyWriteOrder, EA_WEEKLY_WEEK_BATCH, EA_ROSTER_TEAM_BATCH } from "./ea-import-batches.js";

test("chunkItems matches snallabot week batches of 2", () => {
  const weeks = [0, 1, 2, 3, 4, 5];
  assert.deepEqual(chunkItems(weeks, EA_WEEKLY_WEEK_BATCH), [[0, 1], [2, 3], [4, 5]]);
});

test("chunkItems matches snallabot roster batches of 4", () => {
  const teams = Array.from({ length: 10 }, (_, i) => i);
  const batches = chunkItems(teams, EA_ROSTER_TEAM_BATCH);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0], [0, 1, 2, 3]);
  assert.deepEqual(batches[2], [8, 9]);
});

test("weekly write order puts schedule ahead of stats", () => {
  const ordered = weeklyWriteOrder([
    { dataset: "passing" },
    { dataset: "schedule" },
    { dataset: "rushing" },
  ]);
  assert.deepEqual(ordered.map((item) => item.dataset), ["schedule", "passing", "rushing"]);
});
