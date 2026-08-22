import assert from "node:assert/strict";
import test from "node:test";
import { isUnplayedGotwScheduleGame } from "./gotw-nomination.service.js";

test("GOTW treats a scheduled EA 0-0 import as unplayed", () => {
  assert.equal(isUnplayedGotwScheduleGame("scheduled"), true);
});

test("GOTW does not nominate a completed or final game", () => {
  assert.equal(isUnplayedGotwScheduleGame("completed"), false);
  assert.equal(isUnplayedGotwScheduleGame("final"), false);
});
