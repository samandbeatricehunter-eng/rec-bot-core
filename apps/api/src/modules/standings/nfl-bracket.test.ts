import assert from "node:assert/strict";
import test from "node:test";
import { computeRoundMatchups, type AliveSeed } from "./nfl-bracket.service.js";

function seeds(conference: string, count = 7): AliveSeed[] {
  return Array.from({ length: count }, (_, i) => ({ seed: i + 1, teamId: `${conference}-${i + 1}`, conference }));
}

test("wild_card gives seed 1 the bye and pairs 2v7, 3v6, 4v5", () => {
  const matchups = computeRoundMatchups("wild_card", seeds("AFC"));
  assert.equal(matchups.length, 3);
  assert.deepEqual(
    matchups.map((m) => [m.homeSeed, m.awaySeed]).sort((a, b) => a[0] - b[0]),
    [[2, 7], [3, 6], [4, 5]],
  );
  assert.ok(matchups.every((m) => m.conference === "AFC"));
});

test("divisional reseeds: lowest surviving seed plays highest surviving seed", () => {
  // Seeds 1, 2, 5, 7 survived the wild-card round.
  const alive: AliveSeed[] = [
    { seed: 1, teamId: "AFC-1", conference: "AFC" },
    { seed: 2, teamId: "AFC-2", conference: "AFC" },
    { seed: 5, teamId: "AFC-5", conference: "AFC" },
    { seed: 7, teamId: "AFC-7", conference: "AFC" },
  ];
  const matchups = computeRoundMatchups("divisional", alive);
  assert.equal(matchups.length, 2);
  const pairs = matchups.map((m) => [m.homeSeed, m.awaySeed]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(pairs, [[1, 7], [2, 5]]);
});

test("super_bowl pairs the two conference champions with the better seed at home", () => {
  const alive: AliveSeed[] = [
    { seed: 3, teamId: "AFC-3", conference: "AFC" },
    { seed: 1, teamId: "NFC-1", conference: "NFC" },
  ];
  const matchups = computeRoundMatchups("super_bowl", alive);
  assert.equal(matchups.length, 1);
  assert.equal(matchups[0].conference, "SB");
  assert.equal(matchups[0].homeTeamId, "NFC-1");
  assert.equal(matchups[0].awayTeamId, "AFC-3");
});

test("super_bowl with anything other than exactly 2 alive seeds produces no matchup", () => {
  assert.deepEqual(computeRoundMatchups("super_bowl", seeds("AFC", 1)), []);
  assert.deepEqual(computeRoundMatchups("super_bowl", []), []);
});
