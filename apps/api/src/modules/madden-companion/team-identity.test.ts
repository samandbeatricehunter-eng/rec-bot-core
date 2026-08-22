import assert from "node:assert/strict";
import test from "node:test";
import { abbreviationMatchValues, preferredRecAbbreviation, recTeamLooksLikeEaTeam } from "./team-identity.js";

test("AZ aliases to ARI so seeded Cardinals rows match EA exports", () => {
  assert.deepEqual(abbreviationMatchValues("AZ"), ["ARI", "AZ"]);
  assert.equal(preferredRecAbbreviation("AZ"), "ARI");
  assert.equal(
    recTeamLooksLikeEaTeam({
      recName: "Arizona Cardinals",
      recAbbreviation: "ARI",
      eaName: "Cardinals",
      eaAbbreviation: "AZ",
      eaNick: "Cardinals",
      eaCity: "Arizona",
    }),
    true,
  );
});

test("nick-only REC teams still match EA display names", () => {
  assert.equal(
    recTeamLooksLikeEaTeam({
      recName: "49ers",
      recAbbreviation: "SF",
      eaName: "49ers",
      eaAbbreviation: "SF",
    }),
    true,
  );
});

test("unrelated teams do not match", () => {
  assert.equal(
    recTeamLooksLikeEaTeam({
      recName: "Bears",
      recAbbreviation: "CHI",
      eaName: "Cardinals",
      eaAbbreviation: "AZ",
      eaNick: "Cardinals",
      eaCity: "Arizona",
    }),
    false,
  );
});
