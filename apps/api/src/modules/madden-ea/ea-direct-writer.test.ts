import assert from "node:assert/strict";
import test from "node:test";
import { rosterWriteResult } from "./ea-roster-progress.js";

test("roster progress counts unchanged hash-skipped players instead of reporting 0", () => {
  const result = rosterWriteResult(0, 1696);
  assert.equal(result.records, 1696);
  assert.equal(result.duplicate, true);
  assert.equal(result.written, 0);
  assert.equal(result.skipped, 1696);
});

test("roster progress counts a mix of writes and skips", () => {
  const result = rosterWriteResult(12, 40);
  assert.equal(result.records, 52);
  assert.equal(result.duplicate, false);
});

test("an empty free-agent list stays 0 records, not 'already up to date'", () => {
  const result = rosterWriteResult(0, 0);
  assert.equal(result.records, 0);
  assert.equal(result.duplicate, false);
});
