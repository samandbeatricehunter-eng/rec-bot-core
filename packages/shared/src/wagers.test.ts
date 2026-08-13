import assert from "node:assert/strict";
import test from "node:test";
import {
  americanFromDecimal,
  marketsForGame,
  moneylineOddsFromProb,
  parlayBoost,
  parlayOdds,
  potentialPayout,
  spreadOrTotalOdds,
  WAGER_MARKETS,
} from "./wagers.js";

test("CPU-only games only offer moneyline; human games open the full catalog", () => {
  const cpuOnly = marketsForGame(false);
  assert.equal(cpuOnly.length, 1);
  assert.equal(cpuOnly[0]?.key, "moneyline");

  const human = marketsForGame(true);
  assert.equal(human.length, WAGER_MARKETS.length);
  assert.ok(human.some((market) => market.requiresBoxScore));
});

test("moneyline odds apply house margin and clamp extremes", () => {
  const favorite = moneylineOddsFromProb(0.8);
  const underdog = moneylineOddsFromProb(0.2);
  const coinFlip = moneylineOddsFromProb(0.5);

  assert.ok(favorite < underdog);
  assert.ok(favorite >= 1.05);
  assert.ok(underdog <= 15);
  // Fair 50/50 is 2.0; with 5% vig → 1.90
  assert.equal(coinFlip, 1.9);
});

test("spread/total markets use a fixed -110-style price", () => {
  assert.equal(spreadOrTotalOdds(), 1.91);
});

test("parlay boost and combined odds reward multi-leg tickets", () => {
  assert.equal(parlayBoost(1), 1);
  assert.equal(parlayBoost(2), 1.1);
  assert.equal(parlayBoost(3), 1.25);

  const twoLeg = parlayOdds([1.91, 1.91]);
  const threeLeg = parlayOdds([1.91, 1.91, 1.91]);
  assert.ok(threeLeg > twoLeg);
  assert.ok(twoLeg > 1.91 * 1.91); // includes 1.1 boost
});

test("potential payout floors to whole dollars and never returns less than stake", () => {
  assert.equal(potentialPayout(100, 1.91), 191);
  assert.equal(potentialPayout(100, 1.005), 100);
  assert.equal(potentialPayout(50, 2.5), 125);
});

test("american odds formatting covers favorites and underdogs", () => {
  assert.equal(americanFromDecimal(2.5), "+150");
  assert.equal(americanFromDecimal(1.5), "-200");
  assert.equal(americanFromDecimal(1), "+0");
});
