import assert from "node:assert/strict";
import test from "node:test";
import { computeClipValue } from "./stream-autoclip.service.js";

test("a game-winning score in the final minute of a one-score game outscores a garbage-time score in a blowout", () => {
  const clutch = computeClipValue({
    quarter: "4", gameClock: "0:45",
    awayBefore: 20, homeBefore: 24, awayAfter: 26, homeAfter: 24,
  });
  const garbageTime = computeClipValue({
    quarter: "4", gameClock: "2:00",
    awayBefore: 35, homeBefore: 14, awayAfter: 41, homeAfter: 14,
  });
  assert.ok(clutch > garbageTime, `expected clutch (${clutch}) > garbage time (${garbageTime})`);
});

test("a blowout score gets no late-game bonus even with little time left", () => {
  const value = computeClipValue({
    quarter: "4", gameClock: "1:30",
    awayBefore: 14, homeBefore: 35, awayAfter: 14, homeAfter: 42,
  });
  // Base (7 pts * 5 = 35) only -- no lead change, no tying play, margin too big for the
  // closeness or clutch bonuses.
  assert.equal(value, 35);
});

test("a tying score late in a close game scores higher than an early tying score", () => {
  const late = computeClipValue({
    quarter: "4", gameClock: "0:20",
    awayBefore: 21, homeBefore: 24, awayAfter: 24, homeAfter: 24,
  });
  const early = computeClipValue({
    quarter: "1", gameClock: "10:00",
    awayBefore: 7, homeBefore: 10, awayAfter: 10, homeAfter: 10,
  });
  assert.ok(late > early, `expected late tying play (${late}) > early tying play (${early})`);
});

test("a lead change is worth more than a same-team extension of an existing lead", () => {
  const leadChange = computeClipValue({
    quarter: "2", gameClock: "5:00",
    awayBefore: 10, homeBefore: 7, awayAfter: 10, homeAfter: 14,
  });
  const extension = computeClipValue({
    quarter: "2", gameClock: "5:00",
    awayBefore: 10, homeBefore: 7, awayAfter: 17, homeAfter: 7,
  });
  assert.ok(leadChange > extension, `expected lead change (${leadChange}) > lead extension (${extension})`);
});

test("a forced turnover scores higher than a no-op moment with the same score/clock context", () => {
  const context = { quarter: "4", gameClock: "3:00", awayBefore: 17, homeBefore: 20, awayAfter: 17, homeAfter: 20 };
  const turnover = computeClipValue({ ...context, turnover: true });
  const noOp = computeClipValue(context);
  assert.ok(turnover > noOp, `expected turnover (${turnover}) > no-op (${noOp})`);
});

test("a late-game turnover in a one-score game outscores an early turnover in a blowout", () => {
  const clutchTurnover = computeClipValue({
    quarter: "4", gameClock: "1:00",
    awayBefore: 20, homeBefore: 24, awayAfter: 20, homeAfter: 24, turnover: true,
  });
  const garbageTimeTurnover = computeClipValue({
    quarter: "1", gameClock: "10:00",
    awayBefore: 35, homeBefore: 10, awayAfter: 35, homeAfter: 10, turnover: true,
  });
  assert.ok(clutchTurnover > garbageTimeTurnover, `expected clutch turnover (${clutchTurnover}) > garbage-time turnover (${garbageTimeTurnover})`);
});
