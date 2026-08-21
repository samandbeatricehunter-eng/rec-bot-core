import assert from "node:assert/strict";
import test from "node:test";
import { describeImportChanges, type ImportStateSnapshot } from "./ea-auto-import-notify.lib.js";

const base: ImportStateSnapshot = {
  completedGames: 10,
  playerStatRows: 100,
  teamStatRows: 20,
  rosterFingerprint: "abc",
};

test("describes score, stat, and roster changes for auto-import notices", () => {
  assert.deepEqual(describeImportChanges(base, base), []);
  assert.equal(describeImportChanges(base, { ...base, completedGames: 12 })[0]?.kind, "scores");
  assert.equal(describeImportChanges(base, { ...base, playerStatRows: 140 })[0]?.message, "New stats recorded and imported");
  assert.equal(describeImportChanges(base, { ...base, rosterFingerprint: "def" })[0]?.kind, "player_movement");
  assert.equal(describeImportChanges(base, { ...base, completedGames: 11, rosterFingerprint: "xyz" }).length, 2);
});
