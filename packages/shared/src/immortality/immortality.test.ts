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
  hubUnlockStateFrom,
  challengeComplete,
  issuedWeeklyChallenges,
  rookieContractPayout,
  performanceContractPayout,
  MAX_EQUIPPED_CHARACTERISTICS,
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
  personaDnaCatalog,
  personaDnaQuestions,
  playerTraitCatalog,
  playerTraitQuestions,
  playerTraitKey,
  matchupInterviewPool,
  selectMatchupInterviewQuestion,
  scoreMatchupInterviewAnswer,
  isCareerRecordBroken,
  NFL_CAREER_RECORDS,
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

test("standard coin sources are blocked; contracts, highlights, GOTW, interviews, and articles are not", () => {
  assert.equal(isBlockedStandardCoinSource("eos_payout"), true);
  assert.equal(isBlockedStandardCoinSource("player_of_week"), true);
  assert.equal(isBlockedStandardCoinSource("wager"), true);
  assert.equal(isAllowedRiseToImmortalityCoinSource("immortality_contract"), true);
  assert.equal(isAllowedRiseToImmortalityCoinSource("highlight"), true);
  assert.equal(isAllowedRiseToImmortalityCoinSource("gotw"), true);
  assert.equal(riseToImmortalityAllowsCoinCredit("media", "interview_payout"), true);
  assert.equal(riseToImmortalityAllowsCoinCredit("media", "article_payout"), true);
  assert.equal(riseToImmortalityAllowsCoinCredit("wager"), false);
});

test("state machine only allows forward chapter transitions", () => {
  assert.equal(canTransition("ORIGINS", "ORIGINS_COMPLETE"), true);
  assert.equal(canTransition("ORIGINS", "FRANCHISE_ACTIVE"), false);
  assert.equal(canTransition("FRANCHISE_ACTIVE", "OFFSEASON"), true);
  assert.equal(canTransition("REGISTRATION", "ROOKIE_DRAFT_COMPLETE"), true);
  assert.equal(canTransition("ORIGINS", "ROOKIE_DRAFT_COMPLETE"), true);
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

test("natural characteristics cap at three equipped and discounts cap at 30%", () => {
  const catalog = characteristicCatalog("QB");
  // These four don't share any discounted attribute code, so this exercises the count cap in
  // isolation from the overlap rule below.
  const nonOverlapping = ["naturally_fast", "faster_developer", "known_commodity", "generational_ceiling"];
  const over = validateCharacteristicSelection({ positionGroup: "QB", catalog, keys: nonOverlapping });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.error, "count_exceeded");
  const stacked = stackDiscounts([0.2, 0.2, 0.2]);
  assert.ok(stacked <= MAX_ATTRIBUTE_DISCOUNT);
  const legal = validateCharacteristicSelection({
    positionGroup: "QB",
    catalog,
    keys: ["born_with_quick_feet", "faster_developer"],
  });
  assert.equal(legal.ok, true);
  if (legal.ok) assert.ok(legal.selected.length <= MAX_EQUIPPED_CHARACTERISTICS);
});

test("natural characteristics that discount the same attribute can't both be equipped", () => {
  const catalog = characteristicCatalog("QB");
  // Born With Quick Feet discounts AGI/COD; Escape Artist discounts BSK/COD/ACC -- both touch COD.
  const overlapping = validateCharacteristicSelection({
    positionGroup: "QB",
    catalog,
    keys: ["born_with_quick_feet", "escape_artist"],
  });
  assert.equal(overlapping.ok, false);
  if (!overlapping.ok) assert.equal(overlapping.error, "overlapping_attribute");
  // Born With an Arm (THP) and Natural Accuracy (SAC/MAC/DAC) don't overlap.
  const clean = validateCharacteristicSelection({
    positionGroup: "QB",
    catalog,
    keys: ["born_with_an_arm", "natural_accuracy"],
  });
  assert.equal(clean.ok, true);
});

// Regression guard: every trait defined in these catalogs must be grantable by at least one
// interview question option, or it's permanently dead content nobody can ever equip. "conservative"
// is the one deliberate exception -- QB player traits auto-grant it from stacking risk-averse
// picks rather than a direct question option (see scorePlayerTraitInterview).
test("every Persona DNA trait is reachable through the interview", () => {
  const catalog = personaDnaCatalog().map((trait) => trait.key);
  const referenced = new Set(personaDnaQuestions().flatMap((q) => q.options.map((o) => o.traitKey)));
  const unreachable = catalog.filter((key) => !referenced.has(key));
  assert.deepEqual(unreachable, []);
});

test("every QB and MIKE Player Trait is reachable through its interview", () => {
  for (const group of ["QB", "MIKE"] as const) {
    const catalog = playerTraitCatalog(group).map((trait) => trait.key);
    const referenced = new Set(playerTraitQuestions(group).flatMap((q) => q.options.map((o) => o.traitKey)));
    const unreachable = catalog.filter((key) => !referenced.has(key) && key !== playerTraitKey("Conservative"));
    assert.deepEqual(unreachable, []);
  }
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
    budget: 25,
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

test("matchup interview pool has real volume and every option is well-formed", () => {
  const pool = matchupInterviewPool();
  assert.ok(pool.length >= 100, `expected a substantial pool, got ${pool.length}`);
  const ids = new Set(pool.map((q) => q.id));
  assert.equal(ids.size, pool.length, "question ids must be unique");
  for (const question of pool) {
    assert.ok(question.options.length >= 3, `question ${question.id} needs multiple options`);
    for (const option of question.options) {
      assert.ok(option.text.length > 0);
      assert.ok(Object.keys(option.dnaPoints).length > 0, `question ${question.id} option missing dna points`);
    }
  }
});

test("matchup interview selection is deterministic per seed and biases toward context", () => {
  const pool = matchupInterviewPool();
  const a = selectMatchupInterviewQuestion({ pool, context: { isRivalryGame: true }, seed: "league1:prospect1:3" });
  const b = selectMatchupInterviewQuestion({ pool, context: { isRivalryGame: true }, seed: "league1:prospect1:3" });
  assert.equal(a.id, b.id, "same seed must resolve to the same question");

  let rivalryHits = 0;
  for (let week = 0; week < 50; week++) {
    const picked = selectMatchupInterviewQuestion({ pool, context: { isRivalryGame: true }, seed: `seedset:${week}` });
    if (picked.category === "rivalry" || picked.tags.includes("rivalry")) rivalryHits++;
  }
  assert.ok(rivalryHits > 5, `expected rivalry context to meaningfully bias selection, got ${rivalryHits}/50`);
});

test("matchup interview scoring surfaces the flagged bonus opportunity", () => {
  const pool = matchupInterviewPool();
  const withBonus = pool.find((q) => q.options.some((o) => o.bonusOpportunity));
  assert.ok(withBonus, "expected at least one question with a bonus-flagged option");
  const bonusIndex = withBonus!.options.findIndex((o) => o.bonusOpportunity);
  const result = scoreMatchupInterviewAnswer({ question: withBonus!, optionIndex: bonusIndex });
  assert.ok(result.bonusOpportunity);
  assert.ok(result.bonusOpportunity!.xpBonusPct > 0);
});

test("NFL career records match the confirmed tackle numbers and gate correctly", () => {
  assert.equal(NFL_CAREER_RECORDS.tackles_combined.value, 2059);
  assert.equal(NFL_CAREER_RECORDS.tackles_solo.value, 1568);
  assert.equal(isCareerRecordBroken("tackles_combined", 2059), false);
  assert.equal(isCareerRecordBroken("tackles_combined", 2060), true);
});

test("franchise pick can unlock the hub from registration or origins", () => {
  assert.equal(hubUnlockStateFrom("REGISTRATION"), "ROOKIE_DRAFT_COMPLETE");
  assert.equal(hubUnlockStateFrom("ORIGINS"), "ROOKIE_DRAFT_COMPLETE");
  assert.equal(hubUnlockStateFrom("ROOKIE_DRAFT_COMPLETE"), null);
  assert.equal(hubUnlockStateFrom("FRANCHISE_ACTIVE"), null);
});

test("weekly challenge strings evaluate against canonical stat keys", () => {
  assert.equal(challengeComplete("250 passing yards", { pass_yards: 250 }), true);
  assert.equal(challengeComplete("250 passing yards", { pass_yards: 249 }), false);
  assert.equal(challengeComplete("65% completion on 20+ attempts", { completion_pct: 70, pass_attempts: 25 }), true);
  assert.equal(challengeComplete("300 passing yards + 2 TD", { pass_yards: 310, pass_tds: 2 }), true);
  const weekly = issuedWeeklyChallenges({ position: "QB", seed: "league:week:prospect", stats: { pass_yards: 400, pass_tds: 4, pass_attempts: 30, completion_pct: 70 } });
  assert.equal(weekly.length, 3);
  assert.deepEqual(weekly.map((row) => row.tier), ["bronze", "silver", "gold"]);
});

test("rookie contract payouts are one-time ranges seeded by prospect id", () => {
  const a = rookieContractPayout("11111111-1111-1111-1111-111111111111");
  const b = rookieContractPayout("11111111-1111-1111-1111-111111111111");
  assert.deepEqual(a, b);
  assert.ok(a.playerXp >= 2 && a.playerXp <= 5);
  assert.ok(a.coins >= 2000 && a.coins <= 5000);
  const floor = performanceContractPayout({ contractNumber: 2, percentile: 0, negotiatorMultiplier: 1, knownCommodityFloor: true });
  assert.ok(floor.playerXp >= 4);
  assert.ok(floor.coins >= 5000);
});

