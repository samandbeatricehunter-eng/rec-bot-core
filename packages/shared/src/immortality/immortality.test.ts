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
  evaluateChallengeCondition,
  derivedChallengeStats,
  SUPPORTED_CHALLENGE_STATS,
  issuedWeeklyChallenges,
  issuedSeasonChallenges,
  issuedCareerChallenges,
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
  purchaseCharacteristic,
  isProgressionTreePerk,
  personaDnaCatalog,
  personaDnaQuestions,
  playerTraitCatalog,
  playerTraitQuestions,
  playerTraitKey,
  matchupInterviewPool,
  stageInterviewPool,
  selectMatchupInterviewQuestion,
  selectStageInterviewQuestions,
  scoreMatchupInterviewAnswer,
  isCareerRecordBroken,
  NFL_CAREER_RECORDS,
  evaluateSeasonTrend,
  effectiveTrendWindow,
  highestMedalForWeek,
  effectiveDevTrait,
  purchaseDevTraitPromotion,
  purchaseTeammateDevTraitPromotion,
  combinedModifiers,
  stackPostDraftDiscounts,
  WEEKLY_SWEEP_BONUS_PCT,
  applyEffect,
  modifiersFromDefinition,
  emptyModifiers,
  creationDiscountForAttribute,
  xpDiscountForAttribute,
  ALL_ATTRIBUTES_DISCOUNT_CODE,
  type CharacteristicDefinition,
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
  assert.ok(pool.length >= 300, `expected a substantial pool, got ${pool.length}`);
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

test("stage interview pool fills a 3-question slate without repeats", () => {
  const pool = stageInterviewPool();
  assert.ok(pool.length >= 80, `expected a substantial stage pool, got ${pool.length}`);
  const ids = new Set(pool.map((q) => q.id));
  assert.equal(ids.size, pool.length, "stage question ids must be unique");
  const slate = selectStageInterviewQuestions({
    pool,
    group: "training_camp",
    seed: "league1:prospect1:1:preseason:1",
    count: 3,
  });
  assert.equal(slate.length, 3);
  assert.equal(new Set(slate.map((q) => q.id)).size, 3);
  const again = selectStageInterviewQuestions({
    pool,
    group: "training_camp",
    seed: "league1:prospect1:1:preseason:1",
    count: 3,
  });
  assert.deepEqual(slate.map((q) => q.id), again.map((q) => q.id));
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

test("structured conditions evaluate against canonical stat keys", () => {
  assert.equal(evaluateChallengeCondition({ stat: "pass_yards", op: "gte", value: 250 }, { pass_yards: 250 }), true);
  assert.equal(evaluateChallengeCondition({ stat: "pass_yards", op: "gte", value: 250 }, { pass_yards: 249 }), false);
  assert.equal(
    evaluateChallengeCondition({ all: [{ stat: "completion_pct", op: "gte", value: 65 }, { stat: "pass_attempts", op: "gte", value: 20 }] }, { completion_pct: 70, pass_attempts: 25 }),
    true,
  );
  assert.equal(
    evaluateChallengeCondition({ all: [{ stat: "pass_yards", op: "gte", value: 300 }, { stat: "pass_tds", op: "gte", value: 2 }] }, { pass_yards: 310, pass_tds: 2 }),
    true,
  );
  const weekly = issuedWeeklyChallenges({ position: "QB", seed: "league:week:prospect", stats: { pass_yards: 400, pass_tds: 4, pass_attempts: 30, pass_completions: 21 } });
  assert.equal(weekly.length, 3);
  assert.deepEqual(weekly.map((row) => row.tier), ["bronze", "silver", "gold"]);
});

test("evaluateChallengeCondition fails closed on an unsupported or missing stat, never silently passes", () => {
  // @ts-expect-error -- deliberately an unsupported key, mirroring a malformed/removed catalog entry
  assert.equal(evaluateChallengeCondition({ stat: "tackles_for_loss", op: "gte", value: 1 }, { tackles_for_loss: 5 }), false);
  assert.equal(evaluateChallengeCondition({ stat: "pass_yards", op: "gte", value: 1 }, {}), false);
  assert.equal(evaluateChallengeCondition({ any: [{ stat: "takeaways", op: "gte", value: 1 }, { stat: "sacks", op: "gte", value: 1 }] }, { takeaways: 0, sacks: 1 }), true);
  assert.equal(evaluateChallengeCondition({ any: [{ stat: "takeaways", op: "gte", value: 1 }, { stat: "sacks", op: "gte", value: 1 }] }, { takeaways: 0, sacks: 0 }), false);
});

test("derivedChallengeStats computes total_tds/takeaways/turnovers/scrimmage_yards/ypc/ypr, rate stats absent with no attempts", () => {
  const derived = derivedChallengeStats({ pass_tds: 1, rush_tds: 1, receiving_tds: 1, defensive_tds: 1, interceptions: 2, forced_fumbles: 1, fumble_recoveries: 1, interceptions_thrown: 1, rushing_fumbles: 1, rush_yards: 100, rush_attempts: 20, receiving_yards: 50, receptions: 5 });
  assert.equal(derived.total_tds, 4);
  assert.equal(derived.takeaways, 4);
  assert.equal(derived.turnovers, 2);
  assert.equal(derived.scrimmage_yards, 150);
  assert.equal(derived.ypc, 5);
  assert.equal(derived.ypr, 10);
  const noVolume = derivedChallengeStats({});
  assert.equal(noVolume.ypc, undefined);
  assert.equal(noVolume.ypr, undefined);
});

test("pass deflection challenges read the canonical pass_deflections stat", () => {
  assert.equal(evaluateChallengeCondition({ stat: "pass_deflections", op: "gte", value: 1 }, { pass_deflections: 1 }), true);
  assert.equal(evaluateChallengeCondition({ stat: "pass_deflections", op: "gte", value: 1 }, { pass_deflections: 0 }), false);
});

test("no condition in the live catalog references a stat outside SUPPORTED_CHALLENGE_STATS (guards against tackles_for_loss sneaking back in)", () => {
  function checkCondition(condition: unknown): void {
    if (!condition || typeof condition !== "object") return;
    if ("all" in condition) return void (condition as { all: unknown[] }).all.forEach(checkCondition);
    if ("any" in condition) return void (condition as { any: unknown[] }).any.forEach(checkCondition);
    const stat = (condition as { stat?: string }).stat;
    assert.ok(stat && SUPPORTED_CHALLENGE_STATS.has(stat as never), `unsupported stat in catalog: ${stat}`);
  }
  for (const position of ["QB", "HB", "WR", "TE", "CB", "FS", "SS", "MIKE"]) {
    const weekly = issuedWeeklyChallenges({ position, seed: `${position}:catalog-check`, stats: {} });
    const season = issuedSeasonChallenges(position, {}, `${position}:catalog-check`);
    const career = issuedCareerChallenges(position, {}, `${position}:catalog-check`);
    for (const row of [...weekly, ...season, ...career]) checkCondition(row.condition);
  }
});

test("QB and MIKE weekly/season/career pools tripled to 54 challenges each, still 3-tiered", () => {
  for (const position of ["QB", "MIKE"]) {
    const weekly = issuedWeeklyChallenges({ position, seed: `${position}:seed`, stats: {} });
    const season = issuedSeasonChallenges(position, {}, `${position}:season`);
    const career = issuedCareerChallenges(position, {}, `${position}:career`);
    assert.equal(weekly.length, 3, `${position} weekly still issues exactly 3`);
    assert.equal(season.length, 3, `${position} season still has exactly 3 tiers`);
    assert.equal(career.length, 3, `${position} career still has exactly 3 tiers`);
    for (const row of [...season, ...career]) assert.ok(row.label.length > 0, `${position} ${row.id} resolved a non-empty label`);
  }
});

test("season/career variant selection is stable for the same seed and position-only-seeded for legacy positions", () => {
  const a = issuedSeasonChallenges("QB", {}, "league:season:prospectA");
  const b = issuedSeasonChallenges("QB", {}, "league:season:prospectA");
  assert.deepEqual(a.map((row) => row.label), b.map((row) => row.label));
  // A legacy (non-tripled) position's season labels are plain strings, unaffected by seed.
  const hbFirst = issuedSeasonChallenges("HB", {}, "seed-one");
  const hbSecond = issuedSeasonChallenges("HB", {}, "seed-two");
  assert.deepEqual(hbFirst.map((row) => row.label), hbSecond.map((row) => row.label));
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

test("Origins cannot pick Progression Tree perks", () => {
  const catalog = characteristicCatalog("QB");
  const tree = validateCharacteristicSelection({
    positionGroup: "QB",
    catalog,
    keys: ["personnel_chief"],
  });
  assert.equal(tree.ok, false);
  if (!tree.ok) assert.equal(tree.error, "progression_tree_only");
});

test("Self-Made unlocks self promotion; Development Staff unlocks teammate promotion", () => {
  const qb = characteristicCatalog("QB").find((item) => item.key === "self_made");
  const hb = characteristicCatalog("HB").find((item) => item.key === "development_staff");
  assert.ok(qb && hb);
  assert.equal(qb!.modifiers.devTraitPurchaseUnlocked, true);
  assert.equal(qb!.modifiers.teammateDevPurchaseUnlocked, false);
  assert.equal(hb!.modifiers.teammateDevPurchaseUnlocked, true);
  assert.equal(hb!.modifiers.devTraitPurchaseUnlocked, false);
  const self = purchaseDevTraitPromotion({ currentDevTrait: "normal", availableXp: 10, devTraitPurchaseUnlocked: true });
  assert.equal(self.ok, true);
  const blockedSelf = purchaseDevTraitPromotion({ currentDevTrait: "normal", availableXp: 10, devTraitPurchaseUnlocked: false });
  assert.equal(blockedSelf.ok, false);
  const teammate = purchaseTeammateDevTraitPromotion({ currentDevTrait: "star", availableXp: 30, teammateDevPurchaseUnlocked: true });
  assert.equal(teammate.ok, true);
});

test("post-draft attribute discounts stack additively with no cap; creation discounts stay capped", () => {
  // Post-draft/Progression-Tree path: plain sum, no ceiling.
  assert.ok(Math.abs(stackPostDraftDiscounts([0.15, 0.08, 0.05, 0.05]) - 0.33) < 1e-9);
  assert.ok(Math.abs(stackPostDraftDiscounts([0.5, 0.4, 0.3]) - 1.2) < 1e-9);
  // Creation path is unaffected by the split -- still capped at 30% with diminishing weights.
  const creationStacked = stackDiscounts([0.2, 0.2, 0.2]);
  assert.ok(creationStacked <= MAX_ATTRIBUTE_DISCOUNT);
});

test("discountedXpCost floors at 1 XP even when the post-draft discount exceeds 100%", () => {
  const zeroDiscount = discountedXpCost(90, 0);
  assert.equal(zeroDiscount, 12);
  const halved = discountedXpCost(90, 0.5);
  assert.equal(halved, 6);
  const over100 = discountedXpCost(90, 1.5);
  assert.equal(over100, 1);
  const negative = discountedXpCost(90, -0.5);
  assert.equal(negative, 12);
});

test("Competitive Drive contributes a completed-challenge % bonus via combinedModifiers, not a flat XP amount", () => {
  const catalog = characteristicCatalog("QB");
  const competitiveDrive = catalog.find((item) => item.key === "competitive_drive");
  assert.ok(competitiveDrive);
  assert.equal(competitiveDrive!.modifiers.competitiveDriveBonusPct, 0.05);
  const combined = combinedModifiers([competitiveDrive!]);
  assert.equal(combined.competitiveDriveBonusPct, 0.05);
  // Weekly Sweep itself is a fixed constant, not tied to any equipped characteristic.
  assert.equal(WEEKLY_SWEEP_BONUS_PCT, 0.3);
});

test("Progression Tree purchases are additive, gated by tier, and never Origins-only perks", () => {
  const catalog = characteristicCatalog("QB");
  const t1 = ["born_with_quick_feet", "faster_developer"];
  const originsOnly = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: t1, key: "known_commodity", availableXp: 999 });
  assert.equal(originsOnly.ok, false);
  if (!originsOnly.ok) assert.equal(originsOnly.error, "origins_only");
  const locked = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: ["born_with_quick_feet"], key: "personnel_chief", availableXp: 999 });
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.error, "tier_locked");
  const t2 = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: t1, key: "personnel_chief", availableXp: 50 });
  assert.equal(t2.ok, true);
  if (t2.ok) assert.equal(t2.xpCost, 50);
  const t3locked = purchaseCharacteristic({
    positionGroup: "QB", catalog, ownedKeys: t1, key: "self_made", availableXp: 999,
  });
  assert.equal(t3locked.ok, false);
  const t3 = purchaseCharacteristic({
    positionGroup: "QB", catalog, ownedKeys: [...t1, "personnel_chief"], key: "self_made", availableXp: 90,
  });
  assert.equal(t3.ok, true);
  // Pass 6: Immortal Arm is the Precision Passer branch's Tier 4 capstone -- it requires the
  // specific chain (Pocket Architect -> Clutch Gene), not just "any Tier 3 owned."
  const t4locked = purchaseCharacteristic({
    positionGroup: "QB", catalog, ownedKeys: [...t1, "personnel_chief", "self_made"], key: "immortal_arm", availableXp: 999,
  });
  assert.equal(t4locked.ok, false);
  if (!t4locked.ok) { assert.equal(t4locked.error, "prerequisite_locked"); assert.deepEqual(t4locked.missingKeys, ["clutch_gene"]); }
  const t4 = purchaseCharacteristic({
    positionGroup: "QB", catalog, ownedKeys: [...t1, "pocket_architect", "clutch_gene"], key: "immortal_arm", availableXp: 120,
  });
  assert.equal(t4.ok, true);
  assert.equal(isProgressionTreePerk(catalog.find((item) => item.key === "personnel_chief")!), true);
  assert.equal(isProgressionTreePerk(catalog.find((item) => item.key === "faster_developer")!), false);
});

test("applyEffect folds structured effects into CharacteristicModifiers -- discount, boolean flag, and numeric bonus", () => {
  const modifiers = emptyModifiers();
  applyEffect(modifiers, { type: "attribute_xp_discount", attribute: "ALL", rate: 0.05 });
  applyEffect(modifiers, { type: "trade_access" });
  applyEffect(modifiers, { type: "xp_earn_bonus", value: 0.1 });
  assert.equal(modifiers.xpDiscounts[ALL_ATTRIBUTES_DISCOUNT_CODE], 0.05);
  assert.equal(modifiers.tradeAccess, true);
  assert.equal(modifiers.xpEarnBonus, 0.1);
});

test("modifiersFromDefinition uses explicit effects when present, else falls back to the legacy name-matched switch unchanged", () => {
  const explicit = modifiersFromDefinition({ name: "Some New Lane Perk", effect: "Unlocks the Trade Center.", effects: [{ type: "trade_access" }] });
  assert.equal(explicit.tradeAccess, true);
  assert.equal(explicit.xpEarnBonus, 0); // nothing else declared, so nothing else set
  // No `effects` array -- Personnel Chief still resolves via the untouched name-matched switch.
  const legacy = modifiersFromDefinition({ name: "Personnel Chief", effect: "Unlocks the Trade Center after the perk is purchased." });
  assert.equal(legacy.tradeAccess, true);
});

test("purchaseCharacteristic with explicit requires gates on specific keys (AND), not a tier count", () => {
  const catalog: CharacteristicDefinition[] = [
    { key: "lane_t1", displayName: "Lane T1", positionGroup: "QB", slotCost: 1, effect: "", tags: [], modifiers: emptyModifiers(), configurationVersion: "immortality-characteristics-v1" as never, tier: 1, xpCost: 15 },
    { key: "lane_t2a", displayName: "Lane T2A", positionGroup: "QB", slotCost: 1, effect: "", tags: [], modifiers: emptyModifiers(), configurationVersion: "immortality-characteristics-v1" as never, tier: 2, xpCost: 50, requires: ["lane_t1"] },
    { key: "lane_t2b", displayName: "Lane T2B", positionGroup: "QB", slotCost: 1, effect: "", tags: [], modifiers: emptyModifiers(), configurationVersion: "immortality-characteristics-v1" as never, tier: 2, xpCost: 50, requires: ["lane_t1", "other_lane_anchor"] },
  ];
  const missingPrereq = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: [], key: "lane_t2a", availableXp: 999 });
  assert.equal(missingPrereq.ok, false);
  if (!missingPrereq.ok) assert.equal(missingPrereq.error, "prerequisite_locked");
  const met = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: ["lane_t1"], key: "lane_t2a", availableXp: 999 });
  assert.equal(met.ok, true);
  const partiallyMet = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: ["lane_t1"], key: "lane_t2b", availableXp: 999 });
  assert.equal(partiallyMet.ok, false);
  if (!partiallyMet.ok) {
    assert.equal(partiallyMet.error, "prerequisite_locked");
    assert.deepEqual(partiallyMet.missingKeys, ["other_lane_anchor"]);
  }
});

test("creationDiscountForAttribute and xpDiscountForAttribute fold in the ALL sentinel", () => {
  const modifiers = emptyModifiers();
  modifiers.creationDiscounts.AGI = 0.1;
  modifiers.creationDiscounts[ALL_ATTRIBUTES_DISCOUNT_CODE] = 0.05;
  modifiers.xpDiscounts.SPD = 0.08;
  modifiers.xpDiscounts[ALL_ATTRIBUTES_DISCOUNT_CODE] = 0.05;
  assert.ok(creationDiscountForAttribute(modifiers, "AGI") > 0.1); // stacked with ALL, capped at 30%
  assert.ok(creationDiscountForAttribute(modifiers, "COD") > 0); // no direct COD discount, only ALL
  assert.ok(Math.abs(xpDiscountForAttribute(modifiers, "SPD") - 0.13) < 1e-9); // uncapped additive
  assert.ok(Math.abs(xpDiscountForAttribute(modifiers, "AWR") - 0.05) < 1e-9); // ALL only
});

test("spendCreationPoints applies an ALL-keyed discount, not just a specific-code one (Pass 5 bug fix regression)", () => {
  const baseline = { SPD: 80 };
  const noDiscount = spendCreationPoints({ baseline, spent: { SPD: 1 } });
  const withAllDiscount = spendCreationPoints({ baseline, spent: { SPD: 1 }, discounts: { [ALL_ATTRIBUTES_DISCOUNT_CODE]: 0.2 } });
  assert.equal(noDiscount.ok, true);
  assert.equal(withAllDiscount.ok, true);
  if (noDiscount.ok && withAllDiscount.ok) assert.ok(withAllDiscount.spentPoints < noDiscount.spentPoints);
});

test("every position group has a deeper Progression Tree than the original 2-3 nodes", () => {
  for (const group of ["QB", "HB", "WR_TE", "DB", "LB"] as const) {
    const tree = characteristicCatalog(group).filter((item) => isProgressionTreePerk(item));
    const tiers = new Set(tree.map((item) => item.tier));
    assert.ok(tree.length >= 7, `${group} tree is too thin (${tree.length})`);
    assert.ok(tiers.has(2) && tiers.has(3) && tiers.has(4), `${group} is missing a tree tier`);
  }
});

test("no position catalog has two characteristics that collapse to the same key (characteristicKey strips punctuation)", () => {
  for (const group of ["QB", "HB", "WR_TE", "DB", "LB"] as const) {
    const keys = characteristicCatalog(group).map((item) => item.key);
    const dupes = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(dupes, [], `${group} has colliding characteristic keys: ${dupes.join(", ")}`);
  }
});

test("QB and MIKE (Pass 6) each have 4 distinct branches at Tiers 2-4, plus 4 branch-less universal nodes", () => {
  for (const [group, branches] of [
    ["QB", ["precision_passer", "field_general", "gunslinger", "dual_threat"]],
    ["LB", ["run_enforcer", "coverage_commander", "disruptor", "defensive_field_general"]],
  ] as const) {
    const tree = characteristicCatalog(group).filter((item) => isProgressionTreePerk(item));
    const universal = tree.filter((item) => !item.branch);
    assert.deepEqual(new Set(universal.map((item) => item.key)), new Set(["complete_package", "self_made", "personnel_chief", "spotlight"]), `${group} universal nodes changed`);
    for (const branch of branches) {
      const nodes = tree.filter((item) => item.branch === branch).sort((a, b) => a.tier - b.tier);
      assert.deepEqual(nodes.map((item) => item.tier), [2, 3, 4], `${group}'s ${branch} branch isn't a clean T2-T3-T4 chain`);
      assert.equal(nodes[1].requires?.[0], nodes[0].key, `${group}'s ${branch} T3 doesn't require its own T2`);
      assert.equal(nodes[2].requires?.[0], nodes[1].key, `${group}'s ${branch} T4 doesn't require its own T3`);
    }
  }
});

test("Pass 6 branch chains gate on the specific prior node, not a sibling branch's node at the same tier", () => {
  const catalog = characteristicCatalog("QB");
  const t1 = ["born_with_quick_feet", "faster_developer"];
  // Owning Cannon Arm (Gunslinger T2) does not unlock Total Command (Field General T3) --
  // branches are independent chains, not just "any Tier 2."
  const crossBranch = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: [...t1, "cannon_arm"], key: "total_command", availableXp: 999 });
  assert.equal(crossBranch.ok, false);
  if (!crossBranch.ok) assert.equal(crossBranch.error, "prerequisite_locked");
  const sameBranch = purchaseCharacteristic({ positionGroup: "QB", catalog, ownedKeys: [...t1, "film_room_commander"], key: "total_command", availableXp: 90 });
  assert.equal(sameBranch.ok, true);
});

test("season-trend promotions need a real hot streak, not a single gold week", () => {
  const early = evaluateSeasonTrend({ currentDevTrait: "normal", medals: ["gold", "gold", "gold"] });
  assert.equal(early.promote, false);
  const ready = evaluateSeasonTrend({
    currentDevTrait: "normal",
    medals: ["bronze", "silver", "gold", "silver"],
  });
  assert.equal(ready.promote, true);
  if (ready.promote) assert.equal(ready.nextDevTrait, "star");
  const xf = evaluateSeasonTrend({
    currentDevTrait: "superstar",
    medals: ["gold", "gold", "gold", "gold", "gold", "gold", "gold", "gold"],
  });
  assert.equal(xf.promote, true);
  const cold = evaluateSeasonTrend({
    currentDevTrait: "star",
    medals: ["bronze", "bronze", "none", "bronze", "silver", "bronze"],
  });
  assert.equal(cold.promote, false);
  assert.equal(highestMedalForWeek(["bronze", "gold"]), "gold");
  assert.equal(effectiveTrendWindow(6, 0.5), 4);
  assert.equal(effectiveDevTrait("normal", 2), "superstar");
  assert.equal(effectiveDevTrait("star", 0), "star");
});

