import assert from "node:assert/strict";
import test from "node:test";
import { assertRecOvrModelFixtures } from "./ovr-model.js";
import { REC_ARCHETYPE_CATALOG, getRecArchetypeCostMultiplier } from "./archetypes.js";
import { REC_FIRST_NAMES, REC_LAST_NAMES, generateRecPlayerName } from "./name-corpus.js";
import { evaluateRecCustomPlayerBuild, evaluateRecProposedAttributeChange, getRecEditableAttributes, REC_PACKAGE_RULES } from "./build-validator.js";

test("OVR model fixtures and name corpus stay stable", () => {
  assertRecOvrModelFixtures();
  assert.equal(REC_FIRST_NAMES.length, 300, "Expected 300 first names");
  assert.equal(REC_LAST_NAMES.length, 300, "Expected 300 last names");
  assert.equal(new Set(REC_FIRST_NAMES).size, 300, "First names must be unique");
  assert.equal(new Set(REC_LAST_NAMES).size, 300, "Last names must be unique");
  assert.equal(
    generateRecPlayerName("same-seed").fullName,
    generateRecPlayerName("same-seed").fullName,
    "Seeded names must be deterministic",
  );
});

test("archetype catalog has primary attributes and cost multipliers", () => {
  for (const game of ["CFB", "MADDEN"] as const) {
    for (const [position, archetypes] of Object.entries(REC_ARCHETYPE_CATALOG[game])) {
      assert.ok(archetypes.length >= 2, `${game} ${position} needs at least two archetypes`);
      for (const archetype of archetypes) {
        assert.ok(
          archetype.primaryAttributes.length >= 1,
          `${game} ${position}/${archetype.key} has no primary attributes`,
        );
        assert.equal(
          getRecArchetypeCostMultiplier(game, position, archetype.key, archetype.primaryAttributes[0]!),
          1.15,
          "Primary multiplier drift",
        );
      }
    }
  }
});

test("package rules keep tier CP and high-impact caps", () => {
  assert.equal(REC_PACKAGE_RULES[1].highImpactAttributeCap, 88, "Tier 1 cap drift");
  assert.equal(REC_PACKAGE_RULES[1].creationPoints, 4495, "Tier 1 CP drift");
  assert.equal(REC_PACKAGE_RULES[2].creationPoints, 4985, "Tier 2 CP drift");
  assert.equal(REC_PACKAGE_RULES[3].creationPoints, 5670, "Tier 3 CP drift");
  assert.equal(REC_PACKAGE_RULES[4].creationPoints, 6550, "Tier 4 CP drift");
  assert.equal(REC_PACKAGE_RULES[5].creationPoints, 7525, "Tier 5 CP drift");
});

test("WR editable attributes stay position-wide across archetypes", () => {
  const wrEditable = getRecEditableAttributes("CFB", "WR", "speedster");
  assert.ok(wrEditable.includes("spc") && wrEditable.includes("jmp"), "WR fields must remain position-wide across archetypes");
});

test("preview does not block intermediate identity increments; submit does", () => {
  const preview = evaluateRecProposedAttributeChange({
    game: "CFB",
    position: "WR",
    archetypeKey: "route_artist",
    packageTier: 1,
    netDevelopmentCost: 0,
    attributes: {},
    attribute: "srr",
    proposedRating: 1,
  });
  assert.ok(!preview.violations.some((v) => v.code === "ARCHETYPE_IDENTITY"), "Preview must not block intermediate increments on identity");
  const incompleteSubmission = evaluateRecCustomPlayerBuild({
    game: "CFB",
    position: "WR",
    archetypeKey: "route_artist",
    packageTier: 1,
    netDevelopmentCost: 0,
    attributes: {},
    mode: "submit",
  });
  assert.ok(incompleteSubmission.violations.some((v) => v.code === "ARCHETYPE_IDENTITY"), "Submission must enforce identity");
});

test("min-maxed WR is blocked by package cap and attribute floor", () => {
  const blocked = evaluateRecCustomPlayerBuild({
    game: "CFB",
    position: "WR",
    archetypeKey: "speedster",
    packageTier: 2,
    netDevelopmentCost: 0,
    attributes: { spd: 95, acc: 40, drr: 40, rls: 40, cth: 40, srr: 40, mrr: 40, cod: 40 },
  });
  assert.ok(!blocked.valid, "Min-maxed WR must be blocked");
  assert.ok(blocked.violations.some((v) => v.code === "PACKAGE_ATTRIBUTE_CAP"), "Expected package attribute cap violation");
  assert.ok(blocked.violations.some((v) => v.code === "ATTRIBUTE_FLOOR_REQUIRED"), "Expected attribute-floor violation");
});

test("quick-cluster gap applies to WR but not TE at wider spreads", () => {
  const wrSpeedGap = evaluateRecCustomPlayerBuild({
    game: "CFB",
    position: "WR",
    archetypeKey: "speedster",
    packageTier: 5,
    netDevelopmentCost: 0,
    attributes: { spd: 89, agi: 60, acc: 89, cod: 60 },
  });
  assert.ok(wrSpeedGap.violations.some((v) => v.code === "QUICK_CLUSTER_GAP"), "WR with 89 SPD and 60 AGI must be gapped");
  const teSpeedGap = evaluateRecCustomPlayerBuild({
    game: "CFB",
    position: "TE",
    archetypeKey: "vertical_threat",
    packageTier: 5,
    netDevelopmentCost: 0,
    attributes: { spd: 89, agi: 70, acc: 89, cod: 70 },
  });
  assert.ok(!teSpeedGap.violations.some((v) => v.code === "QUICK_CLUSTER_GAP"), "TE with a wider speed/quick spread is fine");
});
