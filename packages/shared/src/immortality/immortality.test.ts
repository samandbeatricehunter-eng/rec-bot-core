import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRiseToImmortalityLockedSettings,
  assignProspectPairs,
  canConvertToTeamXp,
  spendAttributePlusOne,
  canTransition,
  riseHubUnlocked,
  CHARACTERISTIC_SLOT_BUDGET,
  characteristicCatalog,
  discountedXpCost,
  gradeIqSubmission,
  isAllowedRiseToImmortalityCoinSource,
  isBlockedStandardCoinSource,
  riseToImmortalityAllowsCoinCredit,
  isIqTimedOut,
  MAX_ATTRIBUTE_DISCOUNT,
  rejectSelfVote,
  RISE_TO_IMMORTALITY_FORBIDDEN_PURCHASES,
  RISE_TO_IMMORTALITY_LOCKED_SETTINGS,
  scoreIqAttempt,
  scorePerformanceContract,
  shouldApplyRiseToImmortality,
  spendCreationPoints,
  stackDiscounts,
  validateCharacteristicSelection,
} from "./index.js";

test("Rise to Immortality is a Madden 27 template that disables store purchases", () => {
  assert.equal(shouldApplyRiseToImmortality({ templateId: "rise_to_immortality", game: "madden_27" }), true);
  assert.equal(shouldApplyRiseToImmortality({ templateId: "rise_to_immortality", game: "madden_26" }), false);
  const locked = applyRiseToImmortalityLockedSettings({ customPlayersEnabled: true, legendsEnabled: true, attributePurchasesEnabled: true });
  assert.equal(locked.customPlayersEnabled, false);
  assert.equal(locked.legendsEnabled, false);
  assert.equal(locked.devUpgradesEnabled, false);
  assert.equal(locked.ageResetsEnabled, false);
  assert.equal(locked.attributePurchasesEnabled, false);
  assert.equal(locked.contractAdjustmentPurchasesEnabled, false);
  assert.equal(RISE_TO_IMMORTALITY_LOCKED_SETTINGS.injuryPolicy, "off");
  assert.equal(RISE_TO_IMMORTALITY_LOCKED_SETTINGS.wearAndTearEnabled, true);
  assert.ok(RISE_TO_IMMORTALITY_FORBIDDEN_PURCHASES.includes("legend"));
});

test("standard coin sources are blocked; contracts, highlights, GOTW, and interviews are not", () => {
  assert.equal(isBlockedStandardCoinSource("eos_payout"), true);
  assert.equal(isBlockedStandardCoinSource("player_of_week"), true);
  assert.equal(isBlockedStandardCoinSource("wager"), true);
  assert.equal(isAllowedRiseToImmortalityCoinSource("immortality_contract"), true);
  assert.equal(isAllowedRiseToImmortalityCoinSource("highlight"), true);
  assert.equal(isAllowedRiseToImmortalityCoinSource("gotw"), true);
  assert.equal(riseToImmortalityAllowsCoinCredit("media", "interview_payout"), true);
  assert.equal(riseToImmortalityAllowsCoinCredit("media", "article_payout"), false);
  assert.equal(riseToImmortalityAllowsCoinCredit("wager"), false);
});

test("state machine only allows forward chapter transitions", () => {
  assert.equal(canTransition("ORIGINS", "ORIGINS_COMPLETE"), true);
  assert.equal(canTransition("ORIGINS", "FRANCHISE_ACTIVE"), false);
  assert.equal(canTransition("FRANCHISE_ACTIVE", "OFFSEASON"), true);
  assert.equal(canTransition("ORIGINS_COMPLETE", "ROOKIE_DRAFT_COMPLETE"), true);
  assert.equal(canTransition("ROOKIE_DRAFT_PREP", "ROOKIE_DRAFT_COMPLETE"), true);
  assert.equal(canTransition("ROOKIE_DRAFT_LIVE", "ROOKIE_DRAFT_COMPLETE"), true);
});

test("the usual league hub unlocks after the rookie draft assigns franchises", () => {
  assert.equal(riseHubUnlocked("REGISTRATION"), false);
  assert.equal(riseHubUnlocked("ORIGINS"), false);
  assert.equal(riseHubUnlocked("ROOKIE_DRAFT_LIVE"), false);
  assert.equal(riseHubUnlocked("ROOKIE_DRAFT_COMPLETE"), true);
  assert.equal(riseHubUnlocked("FRANCHISE_ACTIVE"), true);
});

test("IQ timeout cannot be bypassed and back-navigation is impossible", () => {
  const started = "2026-08-28T18:00:00.000Z";
  const expires = "2026-08-28T18:00:25.000Z";
  assert.equal(isIqTimedOut(expires, "2026-08-28T18:00:24.000Z"), false);
  assert.equal(isIqTimedOut(expires, "2026-08-28T18:00:25.000Z"), true);
  const question = { number: 1, question: "q", options: ["A", "B", "C", "D"], correctIndex: 1 };
  const timedOut = gradeIqSubmission({
    question,
    optionOrder: [0, 1, 2, 3],
    selectedPresentedIndex: 1,
    timedOut: isIqTimedOut(expires, "2026-08-28T18:00:30.000Z"),
  });
  assert.equal(timedOut.correct, false);
  assert.equal(timedOut.timedOut, true);
  const duplicate = scoreIqAttempt({
    answers: [
      { questionNumber: 1, correct: true },
      { questionNumber: 1, correct: true },
    ],
  });
  assert.equal(duplicate.correctCount, 1);
  assert.equal(duplicate.iqScore, 85);
  void started;
});

test("IQ awareness and PRC formulas are deterministic", () => {
  const perfect = scoreIqAttempt({
    answers: Array.from({ length: 12 }, (_, index) => ({ questionNumber: index + 1, correct: true })),
  });
  assert.equal(perfect.iqScore, 140);
  assert.equal(perfect.awareness, 99);
  assert.equal(perfect.playRecognition, 85);
});

test("characteristic slot budget cannot exceed six and discounts cap at 30%", () => {
  const catalog = characteristicCatalog("QB");
  const expensive = catalog.filter((item) => item.slotCost >= 3).slice(0, 3).map((item) => item.key);
  const over = validateCharacteristicSelection({ positionGroup: "QB", catalog, keys: expensive });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.error, "slot_budget_exceeded");
  const stacked = stackDiscounts([0.2, 0.2, 0.2]);
  assert.ok(stacked <= MAX_ATTRIBUTE_DISCOUNT);
  const legal = validateCharacteristicSelection({
    positionGroup: "QB",
    catalog,
    keys: ["born_with_quick_feet", "faster_developer"],
  });
  assert.equal(legal.ok, true);
  if (legal.ok) assert.ok(legal.slotCost <= CHARACTERISTIC_SLOT_BUDGET);
});

test("Known Commodity floors before Great Negotiator multiplies", () => {
  const poor = scorePerformanceContract({
    productionScore: 10,
    awardsScore: 0,
    postseasonScore: 0,
    modifiers: { knownCommodityFloor: true, negotiatorMultiplier: 1.2 },
  });
  assert.equal(poor.knownCommodityFloorApplied, true);
  assert.equal(poor.coinsPerSeason, 3000);
});

test("Team Player can convert XP immediately; others wait for ceiling", () => {
  assert.equal(canConvertToTeamXp({ currentOvr: 78, devTrait: "normal", teamPlayer: true }), true);
  assert.equal(canConvertToTeamXp({ currentOvr: 78, devTrait: "normal", teamPlayer: false }), false);
  assert.equal(canConvertToTeamXp({ currentOvr: 90, devTrait: "normal", teamPlayer: false }), true);
  assert.equal(discountedXpCost(84, 0.2), Math.round(5 * 0.8));
  const spend = spendAttributePlusOne({ currentValue: 84, discount: 0.2, currentOvr: 78, ceiling: 90, availableXp: 4 });
  assert.equal(spend.ok, true);
  if (spend.ok) assert.equal(spend.cost, 4);
  const short = spendAttributePlusOne({ currentValue: 84, discount: 0, currentOvr: 78, ceiling: 90, availableXp: 4 });
  assert.equal(short.ok, false);
});

test("draft solver assigns both prospects to the same unique franchise", () => {
  const users = ["u1", "u2", "u3"];
  const prospects = users.flatMap((userId, index) => [
    { userId, prospectId: `${userId}-off`, side: "offense" as const, draftValue: 90 - index, projectedRound: 1 + index },
    { userId, prospectId: `${userId}-def`, side: "defense" as const, draftValue: 80 - index, projectedRound: 2 + index },
  ]);
  const franchises = [
    { teamId: "t1", pickOrder: 1 },
    { teamId: "t2", pickOrder: 2 },
    { teamId: "t3", pickOrder: 3 },
  ];
  const assigned = assignProspectPairs({ prospects, franchises });
  assert.equal(assigned.length, 3);
  const teams = new Set(assigned.map((row) => row.teamId));
  assert.equal(teams.size, 3);
  for (const row of assigned) {
    assert.equal(row.picks.length, 2);
    assert.equal(row.picks[0]?.teamId, row.picks[1]?.teamId);
    assert.equal(new Set(row.picks.map((pick) => pick.round)).size, 2);
  }
});

test("Hall self-votes are rejected", () => {
  assert.equal(rejectSelfVote("user-1", "user-1"), true);
  assert.equal(rejectSelfVote("user-1", "user-2"), false);
});

test("creation point spend is recalculated server-side against budget", () => {
  const result = spendCreationPoints({
    baseline: { SPD: 85, ACC: 84 },
    spent: { SPD: 2, ACC: 1 },
    budget: 20,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.attributes.SPD, 87);
    assert.equal(result.attributes.ACC, 85);
  }
  const over = spendCreationPoints({
    baseline: { SPD: 85 },
    spent: { SPD: 5 },
    budget: 5,
  });
  assert.equal(over.ok, false);
});
