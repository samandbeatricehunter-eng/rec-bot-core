import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRiseToImmortalityLockedSettings,
  assignProspectPairs,
  completePairUserIds,
  rankDraftClass,
  seedFranchisePickOrder,
  stockDirection,
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
  abilityById,
  canSelectAbility,
  madden27AbilityCatalog,
  matchingAbilityGate,
  rtiAbilitiesForPosition,
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
  assert.equal(duplicate.iqScore, 95);
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

test("draft stock ranks relative to the class and moves when others join", () => {
  const first = rankDraftClass([
    { prospectId: "a", userId: "u1", side: "offense", firstName: "A", lastName: "One", iqCompleted: true, iqScore: 140, estimatedOvr: 84 },
  ]);
  assert.equal(first[0]?.classRank, 1);
  assert.equal(first[0]?.classSize, 1);
  assert.equal(first[0]?.projectedRound, 1);
  assert.equal(first[0]?.stock, "new");

  const withPeer = rankDraftClass([
    { prospectId: "a", userId: "u1", side: "offense", firstName: "A", lastName: "One", iqCompleted: true, iqScore: 110, estimatedOvr: 78, previousClassRank: 1 },
    { prospectId: "b", userId: "u2", side: "offense", firstName: "B", lastName: "Two", iqCompleted: true, iqScore: 140, estimatedOvr: 84 },
  ]);
  const a = withPeer.find((row) => row.prospectId === "a");
  const b = withPeer.find((row) => row.prospectId === "b");
  assert.equal(b?.classRank, 1);
  assert.equal(a?.classRank, 2);
  assert.equal(a?.classSize, 2);
  assert.equal(a?.stock, "sliding");
  assert.equal(stockDirection(2, 1), "rising");
  assert.ok((b?.draftValue ?? 0) > (a?.draftValue ?? 0));
});

test("only users with both ready prospects form a complete draft pair", () => {
  const ready = completePairUserIds([
    { userId: "u1", side: "offense", ready: true },
    { userId: "u1", side: "defense", ready: true },
    { userId: "u2", side: "offense", ready: true },
    { userId: "u2", side: "defense", ready: false },
  ]);
  assert.deepEqual(ready, ["u1"]);
});

test("franchise pick order is seeded stably from the league id", () => {
  const first = seedFranchisePickOrder("league-a", ["t3", "t1", "t2"]);
  const second = seedFranchisePickOrder("league-a", ["t1", "t2", "t3"]);
  assert.deepEqual(first.map((row) => row.teamId), second.map((row) => row.teamId));
  assert.equal(first[0]?.pickOrder, 1);
  assert.equal(first.length, 3);
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
    const ordered = [...row.picks].sort((a, b) => a.round - b.round);
    assert.equal(ordered[0]?.revealOwnership, false);
    assert.equal(ordered[1]?.revealOwnership, true);
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

test("Madden 27 abilities assign from franchise OVR gates, not REC-controlled tiers", () => {
  const all = madden27AbilityCatalog();
  assert.equal(all.length, 114);
  assert.ok(all.some((row) => row.kind === "xfactor"));
  const qb = rtiAbilitiesForPosition("QB");
  const mike = rtiAbilitiesForPosition("MIKE");
  assert.ok(qb.some((row) => row.name === "Fearless"));
  assert.ok(qb.some((row) => row.name === "Bazooka"));
  assert.ok(mike.some((row) => row.name === "Lurker"));

  const shutdown = abilityById("Z_10");
  assert.ok(shutdown);
  assert.equal(matchingAbilityGate({
    ability: shutdown, position: "CB", archetypes: ["Coverage/Shutdown"], estimatedOvr: 69,
  }), null);
  assert.equal(matchingAbilityGate({
    ability: shutdown, position: "CB", archetypes: ["Coverage/Shutdown"], estimatedOvr: 70,
  })?.ovrMin, 70);
  assert.equal(canSelectAbility({
    ability: shutdown,
    position: "CB",
    archetypes: ["Ball Hawk"],
    estimatedOvr: 90,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, false);
  assert.equal(canSelectAbility({
    ability: shutdown,
    position: "CB",
    archetypes: ["Coverage/Shutdown"],
    estimatedOvr: 70,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, true);

  const bazooka = abilityById("Z_06");
  assert.ok(bazooka);
  assert.equal(canSelectAbility({
    ability: bazooka,
    position: "QB",
    archetypes: ["Field General"],
    estimatedOvr: 99,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, false);
  assert.equal(canSelectAbility({
    ability: bazooka,
    position: "QB",
    archetypes: ["Strong Arm"],
    estimatedOvr: 60,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, true);

  const lurker = abilityById("089");
  assert.ok(lurker);
  assert.equal(canSelectAbility({
    ability: lurker,
    position: "CB",
    archetypes: ["Ball Hawk"],
    estimatedOvr: 85,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, true);
  assert.equal(canSelectAbility({
    ability: lurker,
    position: "MIKE",
    archetypes: ["Run Stopper/Enforcer"],
    estimatedOvr: 95,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, false);
  assert.equal(canSelectAbility({
    ability: lurker,
    position: "MIKE",
    archetypes: ["Coverage LB"],
    estimatedOvr: 90,
    equippedCount: 0,
    alreadyEquipped: false,
  }).ok, true);
});

