import assert from "node:assert/strict";
import test from "node:test";
import { isSyntheticDiscordId } from "./discord-identity-ids.js";

test("site: placeholders are synthetic Discord ids", () => {
  assert.equal(isSyntheticDiscordId("site:abc"), true);
  assert.equal(isSyntheticDiscordId("123456789012345678"), false);
  assert.equal(isSyntheticDiscordId(null), false);
  assert.equal(isSyntheticDiscordId(""), false);
});
