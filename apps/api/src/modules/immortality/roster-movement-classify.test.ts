import assert from "node:assert/strict";
import test from "node:test";
import { classifyRosterMovement } from "./roster-movement-classify.js";

test("no prior state and no team is a no-op, not a signing", () => {
  assert.equal(classifyRosterMovement({ prev: undefined, cur: { teamId: null, isOnPracticeSquad: false } }), null);
});

test("no prior state, real team, active roster -> signed", () => {
  const result = classifyRosterMovement({ prev: undefined, cur: { teamId: "team-a", isOnPracticeSquad: false } });
  assert.deepEqual(result, { kind: "signed", fromTeamId: null, toTeamId: "team-a" });
});

test("no prior state, real team, practice squad -> practice_squad_signed, not a plain signing", () => {
  const result = classifyRosterMovement({ prev: undefined, cur: { teamId: "team-a", isOnPracticeSquad: true } });
  assert.deepEqual(result, { kind: "practice_squad_signed", fromTeamId: null, toTeamId: "team-a" });
});

test("same team, no practice-squad change -> no-op", () => {
  const result = classifyRosterMovement({
    prev: { teamId: "team-a", isOnPracticeSquad: false },
    cur: { teamId: "team-a", isOnPracticeSquad: false },
  });
  assert.equal(result, null);
});

test("free agent signs to an active roster -> signed", () => {
  const result = classifyRosterMovement({
    prev: { teamId: null, isOnPracticeSquad: false },
    cur: { teamId: "team-b", isOnPracticeSquad: false },
  });
  assert.deepEqual(result, { kind: "signed", fromTeamId: null, toTeamId: "team-b" });
});

test("free agent signs to a practice squad -> practice_squad_signed, not a plain signing", () => {
  const result = classifyRosterMovement({
    prev: { teamId: null, isOnPracticeSquad: false },
    cur: { teamId: "team-b", isOnPracticeSquad: true },
  });
  assert.deepEqual(result, { kind: "practice_squad_signed", fromTeamId: null, toTeamId: "team-b" });
});

test("active-roster player released to free agency -> released", () => {
  const result = classifyRosterMovement({
    prev: { teamId: "team-a", isOnPracticeSquad: false },
    cur: { teamId: null, isOnPracticeSquad: false },
  });
  assert.deepEqual(result, { kind: "released", fromTeamId: "team-a", toTeamId: null });
});

test("practice-squad player released to free agency -> practice_squad_released, not a plain release", () => {
  const result = classifyRosterMovement({
    prev: { teamId: "team-a", isOnPracticeSquad: true },
    cur: { teamId: null, isOnPracticeSquad: false },
  });
  assert.deepEqual(result, { kind: "practice_squad_released", fromTeamId: "team-a", toTeamId: null });
});

test("a real team-to-team move with no practice squad involved on either side -> moved (a real trade)", () => {
  const result = classifyRosterMovement({
    prev: { teamId: "team-a", isOnPracticeSquad: false },
    cur: { teamId: "team-b", isOnPracticeSquad: false },
  });
  assert.deepEqual(result, { kind: "moved", fromTeamId: "team-a", toTeamId: "team-b" });
});

test("regression: a team-to-team move where either side touches a practice squad is a practice-squad claim, not a trade", () => {
  // This is the exact false-positive a live commissioner reported: a player signed off one
  // team's practice squad onto another team's roster got flagged as a Trade violation.
  const fromPracticeSquad = classifyRosterMovement({
    prev: { teamId: "team-a", isOnPracticeSquad: true },
    cur: { teamId: "team-b", isOnPracticeSquad: false },
  });
  assert.deepEqual(fromPracticeSquad, { kind: "practice_squad_signed", fromTeamId: "team-a", toTeamId: "team-b" });

  const toPracticeSquad = classifyRosterMovement({
    prev: { teamId: "team-a", isOnPracticeSquad: false },
    cur: { teamId: "team-b", isOnPracticeSquad: true },
  });
  assert.deepEqual(toPracticeSquad, { kind: "practice_squad_signed", fromTeamId: "team-a", toTeamId: "team-b" });
});
