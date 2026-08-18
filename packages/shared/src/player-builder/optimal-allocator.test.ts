import assert from "node:assert/strict";
import test from "node:test";
import { allocateRecOptimalCpForOvr } from "./optimal-allocator.js";
import { evaluateRecCustomPlayerBuild, getRecEffectiveCreationPoints } from "./build-validator.js";
import type { RecPackageTier } from "./archetypes.js";

const TIERS = [1, 2, 3, 4, 5] as const satisfies readonly RecPackageTier[];

const FIXTURES = [
  { game: "CFB" as const, position: "WR", archetypeKey: "speedster" },
  { game: "CFB" as const, position: "QB", archetypeKey: "pocket_passer" },
  { game: "MADDEN" as const, position: "HB", archetypeKey: "elusive_back" },
  { game: "MADDEN" as const, position: "CB", archetypeKey: "man_to_man" },
  { game: "MADDEN" as const, position: "LT", archetypeKey: "pass_protector" },
];

for (const fixture of FIXTURES) {
  for (const tier of TIERS) {
    test(`optimal allocator spends CP legally for ${fixture.game} ${fixture.position}/${fixture.archetypeKey} tier ${tier}`, () => {
      const allocation = allocateRecOptimalCpForOvr({ ...fixture, packageTier: tier });
      const effectiveCreationPoints = getRecEffectiveCreationPoints(fixture.position, tier);
      assert.equal(allocation.creationPoints, effectiveCreationPoints);
      assert.ok(
        allocation.attributeCost <= effectiveCreationPoints,
        `${fixture.game} ${fixture.position}/${fixture.archetypeKey} tier ${tier}: ` +
          `spent ${allocation.attributeCost} CP over budget ${effectiveCreationPoints}`,
      );
      const evaluated = evaluateRecCustomPlayerBuild({
        ...fixture,
        packageTier: tier,
        netDevelopmentCost: 0,
        attributes: allocation.attributes,
        mode: "preview",
      });
      assert.ok(
        !evaluated.violations.some((v) =>
          ["PACKAGE_ATTRIBUTE_CAP", "ATTRIBUTE_FLOOR_REQUIRED", "QUICK_CLUSTER_GAP", "INSUFFICIENT_POINTS"].includes(v.code),
        ),
        `${fixture.game} ${fixture.position}/${fixture.archetypeKey} tier ${tier}: optimal build broke hard rules: ` +
          evaluated.violations.map((v) => v.code).join(", "),
      );
    });
  }
}

// TODO(real-player-accuracy): compare estimateRecPlayerOverall against known Madden catalog /
// roster samples (e.g. apps/api/scripts/data/madden27/madden27_all_rosters.csv) once attribute
// columns are mapped to RecPlayerAttributes with trusted in-game OVR labels. Skip for now —
// the CSV is team/player metadata-heavy and is not a ready OVR calibration fixture, and the
// estimate is unenforced/informational-only as of build rules v1.7.0 anyway.
