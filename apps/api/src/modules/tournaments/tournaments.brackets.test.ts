import assert from "node:assert/strict";
import test from "node:test";
import { generateTournamentBracket, seededBracketOrder } from "@rec/shared";

test("seeded 8-team order is 1 vs 8, 4 vs 5, 2 vs 7, 3 vs 6", () => {
  assert.deepEqual(seededBracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("single-elim 4 with two byes auto-fills round-1 slots", () => {
  const matches = generateTournamentBracket({
    bracketType: "single_elim_4",
    entrantIds: ["a", "b"],
  });
  const round1 = matches.filter((m) => m.side === "winners" && m.round === 1);
  assert.equal(round1.length, 2);
  assert.equal(round1[0]?.playerA, "a");
  assert.equal(round1[0]?.playerB, null);
  assert.equal(round1[1]?.playerA, "b");
  assert.equal(matches.find((m) => m.round === 2)?.winnerFeed, undefined);
  assert.equal(round1[0]?.winnerFeed?.key, "w-2-0");
});

test("double-elim 8 wires WB losers into the loser bracket and a grand final", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const matches = generateTournamentBracket({ bracketType: "double_elim_8", entrantIds: ids });
  assert.ok(matches.some((m) => m.side === "grand_final"));
  const wbFinal = matches.find((m) => m.key === "w-3-0");
  assert.equal(wbFinal?.winnerFeed?.key, "gf-1-0");
  assert.equal(wbFinal?.loserFeed?.key, "l-4-0");
  assert.equal(matches.find((m) => m.key === "w-1-0")?.loserFeed?.key, "l-1-0");
});
