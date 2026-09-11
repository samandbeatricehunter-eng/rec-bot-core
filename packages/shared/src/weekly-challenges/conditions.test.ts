import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateWeeklyChallengeCondition,
  evaluateWeeklyChallengeTiers,
  type WeeklyChallengeEntry,
  type WeeklyChallengeGameContext,
} from "./conditions.js";

function emptyContext(overrides: Partial<WeeklyChallengeGameContext> = {}): WeeklyChallengeGameContext {
  return {
    team: {
      points_for: 0, points_against: 0, off_yards_gained: 0, off_rush_yards: 0, off_pass_yards: 0,
      off_first_down: 0, turnovers_committed: 0, red_zone_off_percentage: 0, generated_turnovers: 0,
      yards_allowed: 0, rush_yards_allowed: 0, pass_yards_allowed: 0, first_downs_allowed: 0,
      red_zone_def_percentage: 0, result: "loss", margin: 0, isAway: false,
    },
    self: {
      sacks: 0, interceptions: 0, forced_fumbles: 0, fumble_recoveries: 0, pass_deflections: 0,
      broken_tackles: 0, rush_tds: 0, pass_tds: 0, receiving_tds: 0, defensive_tds: 0, total_tds: 0,
      interceptions_thrown: 0, rushing_fumbles: 0, rush_20_plus: 0, receptions: 0, receiving_yards: 0,
      fg_made: 0, fg_attempts: 0, fg_50_made: 0, xp_made: 0, xp_attempts: 0, punts_in_20: 0,
      punt_long: 0, touchbacks: 0, completion_pct_team: 0,
    },
    opponent: {
      sacks: 0, interceptions: 0, forced_fumbles: 0, fumble_recoveries: 0, pass_deflections: 0,
      broken_tackles: 0, rush_tds: 0, pass_tds: 0, receiving_tds: 0, defensive_tds: 0, total_tds: 0,
      interceptions_thrown: 0, rushing_fumbles: 0, rush_20_plus: 0, receptions: 0, receiving_yards: 0,
      fg_made: 0, fg_attempts: 0, fg_50_made: 0, xp_made: 0, xp_attempts: 0, punts_in_20: 0,
      punt_long: 0, touchbacks: 0, completion_pct_team: 0,
    },
    selfPlayers: [],
    opponentPlayers: [],
    ...overrides,
  };
}

test("team condition compares against the team's own box score row", () => {
  const ctx = emptyContext({ team: { ...emptyContext().team, points_for: 30 } });
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "team", stat: "points_for", op: "gte", value: 30 }, ctx), true);
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "team", stat: "points_for", op: "gte", value: 31 }, ctx), false);
});

test("result and margin conditions require a win", () => {
  const lossCtx = emptyContext({ team: { ...emptyContext().team, result: "loss", margin: -3 } });
  const winCtx = emptyContext({ team: { ...emptyContext().team, result: "win", margin: 14 } });
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "result", op: "win" }, lossCtx), false);
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "result", op: "win" }, winCtx), true);
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "margin", op: "gte", value: 10 }, winCtx), true);
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "margin", op: "gte", value: 21 }, winCtx), false);
});

test("agg_opponent reads the opposing team's aggregate, not the team's own", () => {
  const ctx = emptyContext({
    self: { ...emptyContext().self, rush_tds: 3 },
    opponent: { ...emptyContext().opponent, rush_tds: 0 },
  });
  // "0 rushing TDs" (defense side, opponent's offense held to zero)
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "agg_opponent", stat: "rush_tds", op: "lte", value: 0 }, ctx), true);
  // the team's OWN rush_tds being 3 must never leak into an agg_opponent check
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "agg", stat: "rush_tds", op: "gte", value: 3 }, ctx), true);
});

test("agg_eq (no misses) requires attempts > 0 -- a team that never kicked doesn't pass 'miss no FGs'", () => {
  const noAttempts = emptyContext();
  const perfect = emptyContext({ self: { ...emptyContext().self, fg_made: 2, fg_attempts: 2 } });
  const missed = emptyContext({ self: { ...emptyContext().self, fg_made: 1, fg_attempts: 2 } });
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "agg_eq", statA: "fg_made", statB: "fg_attempts" }, noAttempts), false);
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "agg_eq", statA: "fg_made", statB: "fg_attempts" }, perfect), true);
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "agg_eq", statA: "fg_made", statB: "fg_attempts" }, missed), false);
});

test("role 'max' finds the single best qualifying player at that position", () => {
  const ctx = emptyContext({
    selfPlayers: [
      { playerId: "wr1", position: "WR", receiving_yards: 60 },
      { playerId: "wr2", position: "WR", receiving_yards: 110 },
      { playerId: "te1", position: "TE", receiving_yards: 200 }, // different position, should not count for RECEIVER-only if excluded
    ],
  });
  assert.equal(evaluateWeeklyChallengeCondition(
    { kind: "role", side: "self", position: "RECEIVER", stat: "receiving_yards", mode: "max", op: "gte", value: 100 }, ctx,
  ), true); // RECEIVER includes WR+TE, so the 200-yard TE also clears it
  assert.equal(evaluateWeeklyChallengeCondition(
    { kind: "role", side: "self", position: "RECEIVER", stat: "receiving_yards", mode: "max", op: "gte", value: 250 }, ctx,
  ), false);
});

test("role 'count' requires at least minCount players to individually clear the bar", () => {
  const ctx = emptyContext({
    selfPlayers: [
      { playerId: "wr1", position: "WR", receiving_yards: 80 },
      { playerId: "wr2", position: "WR", receiving_yards: 76 },
      { playerId: "wr3", position: "WR", receiving_yards: 40 },
    ],
  });
  assert.equal(evaluateWeeklyChallengeCondition(
    { kind: "role", side: "self", position: "RECEIVER", stat: "receiving_yards", mode: "count", op: "gte", value: 75, minCount: 2 }, ctx,
  ), true);
  assert.equal(evaluateWeeklyChallengeCondition(
    { kind: "role", side: "self", position: "RECEIVER", stat: "receiving_yards", mode: "count", op: "gte", value: 75, minCount: 3 }, ctx,
  ), false);
});

test("role 'max' with no qualifying players fails closed for a gte/gt bar (not vacuously true)", () => {
  const ctx = emptyContext({ selfPlayers: [{ playerId: "qb1", position: "QB", scrimmage_yards: 10 }] });
  assert.equal(evaluateWeeklyChallengeCondition(
    { kind: "role", side: "self", position: "HB", stat: "scrimmage_yards", mode: "max", op: "gte", value: 100 }, ctx,
  ), false);
});

test("role 'max' with no qualifying players passes closed for a negation (lt) bar -- 'no receiver reaches 100' with no receivers on record is vacuously true", () => {
  const ctx = emptyContext({ opponentPlayers: [] });
  assert.equal(evaluateWeeklyChallengeCondition(
    { kind: "role", side: "opponent", position: "RECEIVER", stat: "receiving_yards", mode: "max", op: "lt", value: 100 }, ctx,
  ), true);
});

test("evaluateWeeklyChallengeTiers stacks bronze -> silver -> gold and stops at the first unmet tier", () => {
  const entry: WeeklyChallengeEntry = {
    id: "offense_001", side: "offense", name: "Light Up the Board",
    bronze: [{ kind: "team", stat: "points_for", op: "gte", value: 30 }],
    silverAdds: [{ kind: "team", stat: "off_yards_gained", op: "gte", value: 350 }],
    goldAdds: [{ kind: "result", op: "win" }],
  };
  const bronzeOnly = emptyContext({ team: { ...emptyContext().team, points_for: 30, off_yards_gained: 200, result: "loss" } });
  assert.deepEqual(evaluateWeeklyChallengeTiers(entry, bronzeOnly), [
    { tier: "bronze", complete: true }, { tier: "silver", complete: false }, { tier: "gold", complete: false },
  ]);

  const silverButNoWin = emptyContext({ team: { ...emptyContext().team, points_for: 30, off_yards_gained: 400, result: "loss" } });
  assert.deepEqual(evaluateWeeklyChallengeTiers(entry, silverButNoWin), [
    { tier: "bronze", complete: true }, { tier: "silver", complete: true }, { tier: "gold", complete: false },
  ]);

  const allThree = emptyContext({ team: { ...emptyContext().team, points_for: 30, off_yards_gained: 400, result: "win" } });
  assert.deepEqual(evaluateWeeklyChallengeTiers(entry, allThree), [
    { tier: "bronze", complete: true }, { tier: "silver", complete: true }, { tier: "gold", complete: true },
  ]);

  // Missing bronze must fail every tier even if silver/gold's OWN conditions would otherwise pass.
  const missedBronze = emptyContext({ team: { ...emptyContext().team, points_for: 10, off_yards_gained: 400, result: "win" } });
  assert.deepEqual(evaluateWeeklyChallengeTiers(entry, missedBronze), [
    { tier: "bronze", complete: false }, { tier: "silver", complete: false }, { tier: "gold", complete: false },
  ]);
});

test("an unrecognized condition kind fails closed rather than throwing or passing", () => {
  const ctx = emptyContext();
  // @ts-expect-error -- deliberately malformed to exercise the fails-closed default branch
  assert.equal(evaluateWeeklyChallengeCondition({ kind: "not_a_real_kind" }, ctx), false);
});
