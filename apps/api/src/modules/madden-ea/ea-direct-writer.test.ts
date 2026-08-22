import assert from "node:assert/strict";
import test from "node:test";
import { rosterUnchangedWrite, rosterWriteResult } from "./ea-roster-progress.js";

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

test("unchanged roster rows skip the per-player UPDATE when team and FA status match", () => {
  const existing = { hash: "abc", teamId: "team-1", isFreeAgent: false };
  assert.equal(rosterUnchangedWrite(existing, { hash: "abc", teamId: "team-1", isFreeAgent: false }), "skip");
  assert.equal(rosterUnchangedWrite(existing, { hash: "abc", teamId: "team-2", isFreeAgent: false }), "status");
  assert.equal(rosterUnchangedWrite(existing, { hash: "abc", teamId: "team-1", isFreeAgent: true }), "status");
  assert.equal(rosterUnchangedWrite(existing, { hash: "zzz", teamId: "team-1", isFreeAgent: false }), "full");
  assert.equal(rosterUnchangedWrite(undefined, { hash: "abc", teamId: "team-1", isFreeAgent: false }), "full");
});
