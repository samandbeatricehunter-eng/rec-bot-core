import test from "node:test";
import assert from "node:assert/strict";
import { DEV_TRAIT_XP_MULTIPLIER, devTraitXpMultiplier, normalizeMaddenDevTrait } from "./dev-trait.js";

test("devTraitXpMultiplier matches PLAYER_XP_ENGINE.md's documented dev multiplier table", () => {
  assert.equal(devTraitXpMultiplier("normal"), 1.00);
  assert.equal(devTraitXpMultiplier("star"), 1.05);
  assert.equal(devTraitXpMultiplier("superstar"), 1.10);
  assert.equal(devTraitXpMultiplier("xfactor"), 1.15);
});

test("devTraitXpMultiplier normalizes raw EA/companion values before looking up the multiplier", () => {
  assert.equal(devTraitXpMultiplier(2), DEV_TRAIT_XP_MULTIPLIER.superstar);
  assert.equal(devTraitXpMultiplier("Superstar"), DEV_TRAIT_XP_MULTIPLIER.superstar);
  assert.equal(devTraitXpMultiplier("x-factor"), DEV_TRAIT_XP_MULTIPLIER.xfactor);
});

test("devTraitXpMultiplier defaults to Normal (1.00x) for missing/unrecognized values", () => {
  assert.equal(devTraitXpMultiplier(null), 1.00);
  assert.equal(devTraitXpMultiplier(undefined), 1.00);
  assert.equal(devTraitXpMultiplier("not_a_trait"), 1.00);
});

test("normalizeMaddenDevTrait still resolves every key the multiplier table covers", () => {
  for (const key of Object.keys(DEV_TRAIT_XP_MULTIPLIER)) {
    assert.equal(normalizeMaddenDevTrait(key), key);
  }
});
