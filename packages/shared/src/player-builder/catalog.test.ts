import assert from "node:assert/strict";
import test from "node:test";
import { REC_ARCHETYPE_BASE_OVR_TARGET, REC_ARCHETYPE_GROWTH_OVR_TARGET } from "./archetype-templates.js";
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

test("package tiers 1–5 advertise the real-player base/growth OVR targets", () => {
  for (const game of ["CFB", "MADDEN"] as const) {
    for (const pkg of listRecCustomPlayerPackages(game)) {
      assert.equal(pkg.baseOvrTarget, REC_ARCHETYPE_BASE_OVR_TARGET[pkg.tier], `${game} tier ${pkg.tier} baseOvrTarget drifted`);
      assert.equal(pkg.growthOvrTarget, REC_ARCHETYPE_GROWTH_OVR_TARGET[pkg.tier], `${game} tier ${pkg.tier} growthOvrTarget drifted`);
    }
  }
});

test("getRecNetDevelopmentCost clamps to >= 0 and subtracts the tier's dev credit for Madden", () => {
  // Tier 1 has no credit (0); Star costs 400 -> net 400.
  assert.equal(getRecNetDevelopmentCost("MADDEN", 1, "star"), 400);
  // Tier 2's default (Normal) is free, and its credit (300) prices the one-tier-up bump
  // (Star, 400) at exactly the intended 100 CP.
  assert.equal(getRecNetDevelopmentCost("MADDEN", 2, "normal"), 0);
  assert.equal(getRecNetDevelopmentCost("MADDEN", 2, "star"), 100);
  // Tier 3's default (Star) is free; bumping to Superstar costs the intended 200 CP.
  assert.equal(getRecNetDevelopmentCost("MADDEN", 3, "star"), 0);
  assert.equal(getRecNetDevelopmentCost("MADDEN", 3, "superstar"), 200);
  // Tier 4's default (Star) is free; bumping to Superstar costs the intended 400 CP.
  assert.equal(getRecNetDevelopmentCost("MADDEN", 4, "star"), 0);
  assert.equal(getRecNetDevelopmentCost("MADDEN", 4, "superstar"), 400);
  // Tier 5's default (Superstar) is free; bumping to X-Factor costs the intended 700 CP.
  assert.equal(getRecNetDevelopmentCost("MADDEN", 5, "superstar"), 0);
  assert.equal(getRecNetDevelopmentCost("MADDEN", 5, "xfactor"), 700);
});
