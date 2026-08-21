import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetainPlayerAfterEaReconcile } from "./ea-roster-reconcile.js";

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

test("keeps unpaid-content placeholders until they appear in the EA save", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: null, playerSource: "legend", isCustomBuild: false },
      imported,
    ),
    true,
  );
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "custom:foo", playerSource: "custom_player", isCustomBuild: false },
      imported,
    ),
    true,
  );
});

test("keeps minted custom-player builds even if their EA id is absent this import", () => {
  assert.equal(
    shouldRetainPlayerAfterEaReconcile(
      { maddenPlayerId: "999", playerSource: "custom_player", isCustomBuild: true },
      imported,
    ),
    true,
  );
});
