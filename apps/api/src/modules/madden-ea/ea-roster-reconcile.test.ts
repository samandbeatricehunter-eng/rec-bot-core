import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetainPlayerAfterEaReconcile, shouldAdoptNamePlaceholder } from "./ea-roster-reconcile.js";

const imported = new Set(["100", "200"]);

test("keeps a player whose EA roster id is in this import", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "100", playerSource: "madden_companion", isCustomBuild: false },
      imported,
    ),
    true,
  );
});

test("drops a player EA no longer lists (cut, retired, or off this team)", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "999", playerSource: "madden_companion", isCustomBuild: false },
      imported,
    ),
    false,
  );
});

test("drops leftover baseline/seeded rows that never got a numeric EA id", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "madden27: pat-mahomes", playerSource: "imported", isCustomBuild: false },
      imported,
    ),
    false,
  );
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: null, playerSource: "imported", isCustomBuild: false },
      imported,
    ),
    false,
  );
});

test("drops unmatched legend and custom placeholders — the import is the roster", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: null, playerSource: "legend", isCustomBuild: false },
      imported,
    ),
    false,
  );
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "custom:foo", playerSource: "custom_player", isCustomBuild: false },
      imported,
    ),
    false,
  );
});

test("drops minted custom-player builds whose EA id is absent from this import", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "999", playerSource: "custom_player", isCustomBuild: true },
      imported,
    ),
    false,
  );
});

test("keeps a custom-player or legend once their numeric EA id is in this import", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "100", playerSource: "legend", isCustomBuild: false },
      imported,
    ),
    true,
  );
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "200", playerSource: "custom_player", isCustomBuild: true },
      imported,
    ),
    true,
  );
});

test("does not adopt a name placeholder when the numeric EA id already exists", () => {
  const existing = new Set(["100"]);
  assert.equal(shouldAdoptNamePlaceholder(existing, "100"), false);
  assert.equal(shouldAdoptNamePlaceholder(existing, "101"), true);
});
