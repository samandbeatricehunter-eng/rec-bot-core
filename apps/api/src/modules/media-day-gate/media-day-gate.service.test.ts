import test from "node:test";
import assert from "node:assert/strict";
import { isAdvanceInProgress } from "./media-day-gate.service.js";

test("isAdvanceInProgress: null/undefined means no advance running", () => {
  assert.equal(isAdvanceInProgress(null), false);
  assert.equal(isAdvanceInProgress(undefined), false);
});

test("isAdvanceInProgress: a flag set moments ago suppresses the gate", () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  const since = new Date(now - 30_000).toISOString();
  assert.equal(isAdvanceInProgress(since, now), true);
});

test("isAdvanceInProgress: a flag set just under 15 minutes ago still suppresses the gate", () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  const since = new Date(now - (15 * 60 * 1000 - 1_000)).toISOString();
  assert.equal(isAdvanceInProgress(since, now), true);
});

test("isAdvanceInProgress: a flag stuck for over 15 minutes is treated as stale (crashed advance)", () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  const since = new Date(now - (15 * 60 * 1000 + 1_000)).toISOString();
  assert.equal(isAdvanceInProgress(since, now), false);
});

test("isAdvanceInProgress: a garbage timestamp is never treated as in-progress", () => {
  assert.equal(isAdvanceInProgress("not-a-date"), false);
});
