import assert from "node:assert/strict";
import test from "node:test";
import {
  eaScheduleExternalId,
  persistedImportedScores,
  resolveWeeklyImportRefs,
  validateWeekRef,
  weeksThroughCurrent,
} from "./ea-weeks.js";

test("omitted week list defaults to the franchise current week", () => {
  const refs = resolveWeeklyImportRefs({ current: { stageIndex: 1, weekIndex: 5 } });
  assert.deepEqual(refs, [{ stageIndex: 1, weekIndex: 5 }]);
});

test("week_scope current is only the franchise week even late in the season", () => {
  const refs = resolveWeeklyImportRefs({
    weekScope: "current",
    current: { stageIndex: 1, weekIndex: 5 },
  });
  assert.deepEqual(refs, [{ stageIndex: 1, weekIndex: 5 }]);
});

test("week_scope through_current expands 0..current and skips the Pro Bowl", () => {
  const refs = resolveWeeklyImportRefs({
    weekScope: "through_current",
    current: { stageIndex: 1, weekIndex: 22 },
  });
  assert.equal(refs[0]?.weekIndex, 0);
  assert.equal(refs.at(-1)?.weekIndex, 22);
  assert.ok(!refs.some((ref) => ref.weekIndex === 21));
  assert.equal(refs.length, 22);
});

test("through_current in preseason stays in preseason", () => {
  assert.deepEqual(weeksThroughCurrent({ stageIndex: 0, weekIndex: 2 }), [
    { stageIndex: 0, weekIndex: 0 },
    { stageIndex: 0, weekIndex: 1 },
    { stageIndex: 0, weekIndex: 2 },
  ]);
});

test("explicit week_refs win over week_scope", () => {
  const refs = resolveWeeklyImportRefs({
    weekRefs: [{ stageIndex: 1, weekIndex: 0 }],
    weekScope: "through_current",
    current: { stageIndex: 1, weekIndex: 8 },
  });
  assert.deepEqual(refs, [{ stageIndex: 1, weekIndex: 0 }]);
});

test("lone stage/weekIndex is that one week", () => {
  const refs = resolveWeeklyImportRefs({
    stage: 1,
    weekIndex: 0,
    current: { stageIndex: 1, weekIndex: 8 },
  });
  assert.deepEqual(refs, [{ stageIndex: 1, weekIndex: 0 }]);
});

test("invalid explicit refs are rejected", () => {
  assert.throws(() => validateWeekRef({ stageIndex: 1, weekIndex: 21 }), /Pro Bowl/);
  assert.throws(
    () => resolveWeeklyImportRefs({ weekRefs: [{ stageIndex: 1, weekIndex: 21 }], current: { stageIndex: 1, weekIndex: 0 } }),
    /Pro Bowl/,
  );
});

test("schedule external ids are week-scoped", () => {
  assert.equal(eaScheduleExternalId(1, 555), "ea:w1:555");
  assert.notEqual(eaScheduleExternalId(1, 555), eaScheduleExternalId(2, 555));
});

test("unplayed EA games do not persist 0-0 as a final score", () => {
  assert.deepEqual(persistedImportedScores(false, 0, 0), { homeScore: null, awayScore: null });
  assert.deepEqual(persistedImportedScores(true, 24, 17), { homeScore: 24, awayScore: 17 });
  assert.deepEqual(persistedImportedScores(true, 0, 0), { homeScore: 0, awayScore: 0 });
});
