import assert from "node:assert/strict";
import test from "node:test";
import { isImmortalityCreatedPlayer, nextIdentityStatus } from "./player-identity.service.js";

test("numeric id + active roster status + applied in game -> verified", () => {
  const result = nextIdentityStatus({ name: "Alex Li", isNumericId: true, rosterStatus: "active", siblingCount: 0, appliedInGame: true });
  assert.equal(result.status, "verified");
});

test("numeric id + active roster status but NOT applied in game -> matched_pending_apply, not verified", () => {
  const result = nextIdentityStatus({ name: "Alex Li", isNumericId: true, rosterStatus: "active", siblingCount: 0, appliedInGame: false });
  assert.equal(result.status, "matched_pending_apply");
  assert.match(result.note, /Alex Li/);
  assert.match(result.note, /Applied In Game/);
});

test("numeric id + non-active roster status -> stale, with a note naming the player, regardless of applied-in-game", () => {
  const result = nextIdentityStatus({ name: "Alex Li", isNumericId: true, rosterStatus: "removed", siblingCount: 0, appliedInGame: true });
  assert.equal(result.status, "stale");
  assert.match(result.note, /Alex Li/);
  assert.match(result.note, /removed/);
});

test("non-numeric id + only itself sharing the name -> missing, not ambiguous", () => {
  const result = nextIdentityStatus({ name: "Future Hendrix", isNumericId: false, rosterStatus: null, siblingCount: 1, appliedInGame: true });
  assert.equal(result.status, "missing");
});

test("non-numeric id + another placeholder sharing the exact name -> ambiguous", () => {
  const result = nextIdentityStatus({ name: "Future Hendrix", isNumericId: false, rosterStatus: null, siblingCount: 2, appliedInGame: true });
  assert.equal(result.status, "ambiguous");
  assert.match(result.note, /2 placeholders/);
});

test("non-numeric id + zero siblings still resolves (defensive floor, never ambiguous) -> missing", () => {
  const result = nextIdentityStatus({ name: "Ricardo Smith", isNumericId: false, rosterStatus: null, siblingCount: 0, appliedInGame: true });
  assert.equal(result.status, "missing");
});

test("synthetic rti: madden id still counts as a created prospect after adoption helpers load", () => {
  assert.equal(isImmortalityCreatedPlayer("rti:abc", "player-1", new Set()), true);
});

test("adopted numeric madden id still counts as a created prospect via rec_players.id", () => {
  assert.equal(isImmortalityCreatedPlayer("555221356", "player-1", new Set(["player-1"])), true);
});

test("baseline NFL fill with a numeric madden id is not a created prospect", () => {
  assert.equal(isImmortalityCreatedPlayer("555221356", "player-2", new Set(["player-1"])), false);
});
