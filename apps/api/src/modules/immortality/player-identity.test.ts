import assert from "node:assert/strict";
import test from "node:test";
import { nextIdentityStatus } from "./player-identity.service.js";

test("numeric id + active roster status -> verified", () => {
  const result = nextIdentityStatus({ name: "Alex Li", isNumericId: true, rosterStatus: "active", siblingCount: 0 });
  assert.equal(result.status, "verified");
});

test("numeric id + non-active roster status -> stale, with a note naming the player", () => {
  const result = nextIdentityStatus({ name: "Alex Li", isNumericId: true, rosterStatus: "removed", siblingCount: 0 });
  assert.equal(result.status, "stale");
  assert.match(result.note, /Alex Li/);
  assert.match(result.note, /removed/);
});

test("non-numeric id + only itself sharing the name -> missing, not ambiguous", () => {
  const result = nextIdentityStatus({ name: "Future Hendrix", isNumericId: false, rosterStatus: null, siblingCount: 1 });
  assert.equal(result.status, "missing");
});

test("non-numeric id + another placeholder sharing the exact name -> ambiguous", () => {
  const result = nextIdentityStatus({ name: "Future Hendrix", isNumericId: false, rosterStatus: null, siblingCount: 2 });
  assert.equal(result.status, "ambiguous");
  assert.match(result.note, /2 placeholders/);
});

test("non-numeric id + zero siblings still resolves (defensive floor, never ambiguous) -> missing", () => {
  const result = nextIdentityStatus({ name: "Ricardo Smith", isNumericId: false, rosterStatus: null, siblingCount: 0 });
  assert.equal(result.status, "missing");
});
