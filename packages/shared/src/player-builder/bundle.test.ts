import { assertRecOvrModelFixtures } from "./ovr-model.js";
import { REC_ARCHETYPE_CATALOG, getRecArchetypeCostMultiplier } from "./archetypes.js";
import { REC_FIRST_NAMES, REC_LAST_NAMES, generateRecPlayerName } from "./name-corpus.js";
import { evaluateRecCustomPlayerBuild, evaluateRecProposedAttributeChange, getRecEditableAttributes, REC_PACKAGE_RULES } from "./build-validator.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assertRecOvrModelFixtures();
assert(REC_FIRST_NAMES.length === 300, "Expected 300 first names");
assert(REC_LAST_NAMES.length === 300, "Expected 300 last names");
assert(new Set(REC_FIRST_NAMES).size === 300, "First names must be unique");
assert(new Set(REC_LAST_NAMES).size === 300, "Last names must be unique");
assert(generateRecPlayerName("same-seed").fullName === generateRecPlayerName("same-seed").fullName, "Seeded names must be deterministic");
for (const game of ["CFB", "MADDEN"] as const) {
  for (const [position, archetypes] of Object.entries(REC_ARCHETYPE_CATALOG[game])) {
    assert(archetypes.length >= 2, `${game} ${position} needs at least two archetypes`);
    for (const archetype of archetypes) {
      assert(archetype.primaryAttributes.length >= 1, `${game} ${position}/${archetype.key} has no primary attributes`);
      assert(getRecArchetypeCostMultiplier(game, position, archetype.key, archetype.primaryAttributes[0]!) === 1.15, "Primary multiplier drift");
    }
  }
}
assert(REC_PACKAGE_RULES[1].highImpactAttributeCap === 88, "Tier 1 cap drift");
assert(REC_PACKAGE_RULES[5].creationPoints === 5950, "Tier 5 CP drift");
const wrEditable = getRecEditableAttributes("CFB", "WR", "speedster");
assert(wrEditable.includes("spc") && wrEditable.includes("jmp"), "WR fields must remain position-wide across archetypes");
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
assert(!preview.violations.some((v) => v.code === "ARCHETYPE_IDENTITY"), "Preview must not block intermediate increments on identity");
const incompleteSubmission = evaluateRecCustomPlayerBuild({
  game: "CFB",
  position: "WR",
  archetypeKey: "route_artist",
  packageTier: 1,
  netDevelopmentCost: 0,
  attributes: {},
  mode: "submit",
});
assert(incompleteSubmission.violations.some((v) => v.code === "ARCHETYPE_IDENTITY"), "Submission must enforce identity");

const blocked = evaluateRecCustomPlayerBuild({
  game: "CFB",
  position: "WR",
  archetypeKey: "speedster",
  packageTier: 2,
  netDevelopmentCost: 0,
  attributes: { spd: 95, acc: 40, drr: 40, rls: 40, cth: 40, srr: 40, mrr: 40, cod: 40 },
});
assert(!blocked.valid, "Min-maxed WR must be blocked");
assert(blocked.violations.some((v) => v.code === "PACKAGE_ATTRIBUTE_CAP"), "Expected package attribute cap violation");
assert(blocked.violations.some((v) => v.code === "ATTRIBUTE_FLOOR_REQUIRED"), "Expected attribute-floor violation");
console.log("REC custom-player v1.1 fixtures passed");
