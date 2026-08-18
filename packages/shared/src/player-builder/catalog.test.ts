import assert from "node:assert/strict";
import test from "node:test";
import { getRecAdvertisedCreationPoints } from "./build-validator.js";
import { getRecNetDevelopmentCost, listRecCustomPlayerPackages } from "./catalog.js";

const EXPECTED_COIN_PRICES = [500, 750, 1000, 1500, 2000] as const;

test("listRecCustomPlayerPackages coin prices are fixed for CFB and MADDEN", () => {
  for (const game of ["CFB", "MADDEN"] as const) {
    const packages = listRecCustomPlayerPackages(game);
    assert.deepEqual(
      packages.map((pkg) => pkg.coinPrice),
      [...EXPECTED_COIN_PRICES],
      `${game} coin prices drifted`,
    );
  }
});

test("package tiers 1–5 advertise the post-seed CP figure (real spendable amount)", () => {
  for (const game of ["CFB", "MADDEN"] as const) {
    for (const pkg of listRecCustomPlayerPackages(game)) {
      assert.equal(
        pkg.creationPoints,
        getRecAdvertisedCreationPoints(pkg.tier),
        `${game} tier ${pkg.tier} creationPoints drifted from the advertised (post-seed) figure`,
      );
    }
  }
});

test("getRecNetDevelopmentCost clamps to >= 0 and subtracts includedDevCredit for Madden", () => {
  // Tier 1 has no includedDevCredit (0); Star costs 400 뿯↽ net 400
  assert.equal(getRecNetDevelopmentCost("MADDEN", 1, "star"), 400);
  // Tier 3+ includes 400 credit; Superstar costs 1000 뿯↽ net 600
  assert.equal(getRecNetDevelopmentCost("MADDEN", 3, "superstar"), 600);
  // Credit can exceed absolute cost 뿯↽ clamp to 0 (Normal is free; credit still applied)
  assert.equal(getRecNetDevelopmentCost("MADDEN", 5, "normal"), 0);
  // Tier 5 credit (400) fully covers Star (400)
  assert.equal(getRecNetDevelopmentCost("MADDEN", 5, "star"), 0);
  // X-Factor 1800 − 400 = 1400
  assert.equal(getRecNetDevelopmentCost("MADDEN", 4, "xfactor"), 1400);
});
