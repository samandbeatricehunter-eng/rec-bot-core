import test from "node:test";
import assert from "node:assert/strict";
import { classifyQualifyingReason, pickMostInstigating, INVERSE_POSITIONS, type InstigatorCandidate } from "./beef.service.js";

test("classifyQualifyingReason: rivalry wins over every other signal", () => {
  const reason = classifyQualifyingReason({
    isRivalry: true, isPlayoff: true, homeDivision: "AFC East", awayDivision: "AFC East",
    homeScore: 20, awayScore: 19,
  });
  assert.equal(reason, "rivalry");
});

test("classifyQualifyingReason: playoff wins over division and clutch", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: true, homeDivision: "AFC East", awayDivision: "AFC East",
    homeScore: 20, awayScore: 17,
  });
  assert.equal(reason, "playoff");
});

test("classifyQualifyingReason: division wins over clutch", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: false, homeDivision: "NFC West", awayDivision: "NFC West",
    homeScore: 24, awayScore: 21,
  });
  assert.equal(reason, "division");
});

test("classifyQualifyingReason: a one-score final margin qualifies as clutch", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: false, homeDivision: "AFC East", awayDivision: "NFC West",
    homeScore: 24, awayScore: 20,
  });
  assert.equal(reason, "clutch");
});

test("classifyQualifyingReason: a margin over the clutch threshold does not qualify", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: false, homeDivision: "AFC East", awayDivision: "NFC West",
    homeScore: 31, awayScore: 10,
  });
  assert.equal(reason, null);
});

test("classifyQualifyingReason: a tie game (margin 0) is not clutch", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: false, homeDivision: "AFC East", awayDivision: "NFC West",
    homeScore: 17, awayScore: 17,
  });
  assert.equal(reason, null);
});

test("classifyQualifyingReason: missing scores never qualify as clutch", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: false, homeDivision: "AFC East", awayDivision: "NFC West",
    homeScore: null, awayScore: null,
  });
  assert.equal(reason, null);
});

test("classifyQualifyingReason: a custom clutch margin is respected", () => {
  const reason = classifyQualifyingReason({
    isRivalry: false, isPlayoff: false, homeDivision: "AFC East", awayDivision: "NFC West",
    homeScore: 24, awayScore: 14, clutchMargin: 10,
  });
  assert.equal(reason, "clutch");
});

test("pickMostInstigating: picks the lowest tone weight below 0.5", () => {
  const candidates: InstigatorCandidate[] = [
    { playerId: "a", playerName: "A", position: "WR", toneWeight: 0.45 },
    { playerId: "b", playerName: "B", position: "CB", toneWeight: 0.2 },
    { playerId: "c", playerName: "C", position: "QB", toneWeight: 0.6 },
  ];
  const picked = pickMostInstigating(candidates);
  assert.equal(picked?.playerId, "b");
});

test("pickMostInstigating: returns null when nobody leans instigate", () => {
  const candidates: InstigatorCandidate[] = [
    { playerId: "a", playerName: "A", position: "WR", toneWeight: 0.5 },
    { playerId: "b", playerName: "B", position: "CB", toneWeight: 0.8 },
  ];
  assert.equal(pickMostInstigating(candidates), null);
});

test("pickMostInstigating: returns null for an empty roster", () => {
  assert.equal(pickMostInstigating([]), null);
});

test("INVERSE_POSITIONS: every mapped offensive position has a real defensive counterpart and vice versa", () => {
  const OFFENSE = new Set(["QB", "HB", "FB", "WR", "TE", "LT", "RT", "LG", "RG", "C"]);
  const DEFENSE = new Set(["LEDGE", "REDGE", "DT", "MIKE", "WILL", "SAM", "CB", "FS", "SS"]);
  for (const [position, targets] of Object.entries(INVERSE_POSITIONS)) {
    assert.ok(targets && targets.length > 0, `${position} has no mapped targets`);
    const isOffense = OFFENSE.has(position);
    const isDefense = DEFENSE.has(position);
    assert.ok(isOffense || isDefense, `${position} is neither a known offensive nor defensive position`);
    for (const target of targets!) {
      if (isOffense) assert.ok(DEFENSE.has(target), `${position} (offense) maps to non-defensive ${target}`);
      if (isDefense) assert.ok(OFFENSE.has(target), `${position} (defense) maps to non-offensive ${target}`);
    }
  }
});
