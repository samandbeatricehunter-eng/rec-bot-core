import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateUnifiedPlayerChallenge,
  evaluateUnifiedTeamChallenge,
  pickUnifiedPlayerChallenge,
  unifiedPlayerChallengeCatalog,
  unifiedTeamChallengeCatalog,
  type UnifiedPlayerChallenge,
  type UnifiedTeamChallenge,
} from "./unified.js";
import type { WeeklyChallengeGameContext } from "./conditions.js";

const SUPPORTED_TEAM_CONDITION_KINDS = new Set([
  "team", "agg", "agg_opponent", "agg_eq", "team_margin_turnover", "result", "win_away", "margin", "role", "all",
]);

function walkTeamConditions(challenge: UnifiedTeamChallenge): unknown[] {
  const out: unknown[] = [];
  const visit = (condition: any) => {
    out.push(condition);
    if (condition.kind === "all") for (const part of condition.parts ?? []) visit(part);
  };
  for (const condition of [...challenge.bronze, ...challenge.silverAdds, ...challenge.goldAdds]) visit(condition);
  return out;
}

function walkPlayerConditions(challenge: UnifiedPlayerChallenge): unknown[] {
  const out: unknown[] = [];
  const visit = (condition: any) => {
    out.push(condition);
    for (const part of condition.all ?? []) visit(part);
    for (const part of condition.any ?? []) visit(part);
  };
  for (const condition of [...challenge.bronze, ...challenge.silverAdds, ...challenge.goldAdds]) visit(condition);
  return out;
}

test("unified V2 catalogs match the final package contract", () => {
  const team = unifiedTeamChallengeCatalog();
  const player = unifiedPlayerChallengeCatalog();

  assert.equal(team.length, 106);
  assert.equal(team.filter((entry) => entry.pool === "standard").length, 80);
  assert.equal(team.filter((entry) => entry.pool === "contextual").length, 26);
  assert.equal(player.length, 124);

  const playerPositions = new Set(player.flatMap((entry) => entry.positions));
  assert.equal(playerPositions.has("OL"), false);
  assert.equal(playerPositions.has("K"), false);
  assert.equal(playerPositions.has("P"), false);

  for (const entry of team) {
    assert.equal(entry.assignmentClass, "TEAM");
    assert.ok(entry.bronze.length > 0);
    if (entry.pool === "contextual") {
      assert.ok(entry.contextTags.length > 0 || Object.keys(entry.eligibility ?? {}).length > 0);
    }
    for (const condition of walkTeamConditions(entry) as any[]) {
      assert.ok(SUPPORTED_TEAM_CONDITION_KINDS.has(condition.kind), `${entry.id} has unsupported kind ${condition.kind}`);
    }
  }

  for (const entry of player) {
    assert.equal(entry.assignmentClass, "PLAYER");
    assert.ok(entry.positions.length > 0);
    assert.ok(entry.bronze.length > 0);
    for (const condition of walkPlayerConditions(entry) as any[]) {
      assert.ok("stat" in condition || "all" in condition || "any" in condition, `${entry.id} has malformed condition`);
    }
  }
});

test("player evaluator supports any conditions and cumulative tiers", () => {
  const challenge = unifiedPlayerChallengeCatalog().find((entry) => entry.id === "player_qb_010");
  assert.ok(challenge);

  const results = evaluateUnifiedPlayerChallenge(challenge, {
    position: "QB",
    archetype: "improviser",
    recent: {},
    stats: { pass_yards: 230, rush_yards: 0, pass_tds: 3, interceptions_thrown: 1, rushing_fumbles: 0 },
  });

  assert.deepEqual(results.map((row) => [row.tier, row.complete]), [
    ["bronze", true],
    ["silver", true],
    ["gold", true],
  ]);
});

test("team evaluator keeps Gold dependent on Silver and Bronze", () => {
  const challenge = unifiedTeamChallengeCatalog().find((entry) => entry.id === "team_off_001");
  assert.ok(challenge);

  const base: WeeklyChallengeGameContext = {
    team: {
      points_for: 20, points_against: 10, off_yards_gained: 0, off_rush_yards: 0, off_pass_yards: 0,
      off_first_down: 0, turnovers_committed: 0, red_zone_off_percentage: 0, generated_turnovers: 0,
      yards_allowed: 0, rush_yards_allowed: 0, pass_yards_allowed: 0, first_downs_allowed: 0,
      red_zone_def_percentage: 0, result: "win", margin: 10, isAway: false,
    },
    self: {} as WeeklyChallengeGameContext["self"],
    opponent: {} as WeeklyChallengeGameContext["opponent"],
    selfPlayers: [],
    opponentPlayers: [],
  };

  const belowBronze = evaluateUnifiedTeamChallenge(challenge, base);
  assert.deepEqual(belowBronze.map((row) => row.complete), [false, false, false]);

  const goldWithoutSilver = evaluateUnifiedTeamChallenge(challenge, {
    ...base,
    team: { ...base.team, points_for: 24, turnovers_committed: 0 },
  });
  assert.deepEqual(goldWithoutSilver.map((row) => row.complete), [true, false, false]);

  const gold = evaluateUnifiedTeamChallenge(challenge, {
    ...base,
    team: { ...base.team, points_for: 31, turnovers_committed: 0 },
  });
  assert.deepEqual(gold.map((row) => row.complete), [true, true, true]);
});

test("RTI supported prospect positions can resolve a player challenge", () => {
  for (const position of ["QB", "HB", "WR", "TE", "CB", "FS", "SS", "MIKE", "WILL", "SAM", "LEDGE", "REDGE", "DT"]) {
    const challenge = pickUnifiedPlayerChallenge({ seed: `rti:${position}`, position, archetype: null });
    assert.ok(challenge, `missing challenge for ${position}`);
  }
});
