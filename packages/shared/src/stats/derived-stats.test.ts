import assert from "node:assert/strict";
import test from "node:test";
import { attachDerivedPlayerStats, nflPasserRating } from "./derived-stats.js";
import { canonicalKeyForTaggedStat, coerceSourceStatBag } from "./tagged-stat-keys.js";

test("nflPasserRating matches EA passerRating for a real imported week", () => {
  // Week 7 Jayden Daniels: 19/32, 192 yds, 1 TD, 1 INT → EA passerRating 73.9
  const rating = nflPasserRating({ attempts: 32, completions: 19, yards: 192, touchdowns: 1, interceptions: 1 });
  assert.equal(rating, 73.9);
});

test("nflPasserRating is null with no attempts", () => {
  assert.equal(nflPasserRating({ attempts: 0, completions: 0, yards: 0, touchdowns: 0, interceptions: 0 }), null);
});

test("attachDerivedPlayerStats writes QBR from imported canonical passing totals", () => {
  const derived = attachDerivedPlayerStats({
    pass_attempts: 32,
    pass_completions: 19,
    pass_yards: 192,
    pass_tds: 1,
    interceptions_thrown: 1,
    rush_attempts: 10,
    rush_yards: 45,
    receptions: 5,
    receiving_yards: 80,
  });
  assert.equal(derived.qbr, 73.9);
  assert.equal(derived.passer_rating, 73.9);
  assert.ok(Math.abs((derived.completion_pct ?? 0) - 59.375) < 0.01);
  assert.equal(derived.yards_per_attempt, 6);
  assert.equal(derived.yards_per_carry, 4.5);
  assert.equal(derived.yards_per_reception, 16);
});

test("attachDerivedPlayerStats uses box-score / manual passing keys for QBR", () => {
  const derived = attachDerivedPlayerStats({
    completions: 19,
    attempts: 32,
    yards: 192,
    touchdowns: 1,
    interceptions: 1,
  });
  assert.equal(derived.pass_attempts, 32);
  assert.equal(derived.qbr, 73.9);
});

test("attachDerivedPlayerStats keeps a source passer rating when counting stats are missing", () => {
  const derived = attachDerivedPlayerStats({ passer_rating: 118.4 });
  assert.equal(derived.qbr, 118.4);
});

test("canonicalKeyForTaggedStat maps box-score passing labels", () => {
  assert.equal(canonicalKeyForTaggedStat("yards", "Passing yards"), "pass_yards");
  assert.equal(canonicalKeyForTaggedStat("yards", "Rushing yards"), "rush_yards");
  assert.equal(canonicalKeyForTaggedStat("attempts", "Attempts"), "pass_attempts");
  assert.equal(canonicalKeyForTaggedStat("carries", "Carries"), "rush_attempts");
  assert.equal(
    canonicalKeyForTaggedStat("interceptions", "Interceptions", ["completions", "attempts"]),
    "interceptions_thrown",
  );
  assert.equal(
    canonicalKeyForTaggedStat("interceptions", "Interceptions", ["pass_deflections"]),
    "interceptions",
  );
});

test("coerceSourceStatBag does not smash already-canonical import keys", () => {
  const bag = coerceSourceStatBag({ pass_attempts: 10, pass_yards: 120, passer_rating: 91.2 });
  assert.equal(bag.pass_attempts, 10);
  assert.equal(bag.pass_yards, 120);
  assert.equal(bag.passer_rating, 91.2);
});
