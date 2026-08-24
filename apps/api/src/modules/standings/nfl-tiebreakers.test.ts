import assert from "node:assert/strict";
import test from "node:test";
import { resolveTiebreaker, sortStandingsWithTiebreakers, type TeamGameFact, type TeamStanding } from "./nfl-tiebreakers.js";

function standing(teamId: string, opts: Partial<TeamStanding> = {}): TeamStanding {
  return {
    teamId,
    conference: "AFC",
    division: "East",
    wins: 0,
    losses: 0,
    ties: 0,
    pf: 0,
    pa: 0,
    gamesPlayed: 0,
    winPct: 0,
    ...opts,
  };
}

function game(fact: Partial<TeamGameFact> & { teamId: string; opponentTeamId: string }): TeamGameFact {
  return {
    weekNumber: 1,
    isHome: true,
    pointsFor: 24,
    pointsAgainst: 17,
    isTie: false,
    won: true,
    opponentConference: "AFC",
    opponentDivision: "East",
    ...fact,
  };
}

test("head-to-head sweep resolves a two-way tie", () => {
  // A beat B twice; both otherwise 10-6-0 (winPct .625).
  const a = standing("A", { wins: 10, losses: 6, winPct: 0.625, pf: 300, pa: 250 });
  const b = standing("B", { wins: 10, losses: 6, winPct: 0.625, pf: 290, pa: 260 });
  const games = new Map<string, TeamGameFact[]>([
    ["A", [game({ teamId: "A", opponentTeamId: "B", won: true }), game({ teamId: "A", opponentTeamId: "B", won: true })]],
    ["B", [game({ teamId: "B", opponentTeamId: "A", won: false }), game({ teamId: "B", opponentTeamId: "A", won: false })]],
  ]);
  const allStandings = new Map([["A", a], ["B", b]]);
  const order = resolveTiebreaker([a, b], games, allStandings, { sameDivision: true });
  assert.deepEqual(order, ["A", "B"]);
});

test("common-games win% resolves a wildcard tie with no head-to-head games", () => {
  const a = standing("A", { conference: "AFC", division: "East", wins: 10, losses: 6, winPct: 0.625 });
  const b = standing("B", { conference: "AFC", division: "West", wins: 10, losses: 6, winPct: 0.625 });
  const commonOpponents = ["C", "D", "E", "F"];
  const gamesA: TeamGameFact[] = commonOpponents.map((opp, i) =>
    game({ teamId: "A", opponentTeamId: opp, opponentConference: "AFC", opponentDivision: "North", won: i < 3 }),
  );
  const gamesB: TeamGameFact[] = commonOpponents.map((opp, i) =>
    game({ teamId: "B", opponentTeamId: opp, opponentConference: "AFC", opponentDivision: "North", won: i < 2 }),
  );
  const games = new Map<string, TeamGameFact[]>([["A", gamesA], ["B", gamesB]]);
  const allStandings = new Map([["A", a], ["B", b]]);
  // Not same-division (wildcard tiebreak), so division-record step is skipped and this falls
  // straight to common games: A is 3-1 (.75) vs B 2-2 (.5) against the same 4 opponents.
  const order = resolveTiebreaker([a, b], games, allStandings, { sameDivision: false });
  assert.deepEqual(order, ["A", "B"]);
});

test("falls all the way to point differential when every rulebook step ties", () => {
  const a = standing("A", { winPct: 0.5, pf: 300, pa: 250 });
  const b = standing("B", { winPct: 0.5, pf: 280, pa: 260 });
  const games = new Map<string, TeamGameFact[]>();
  const allStandings = new Map([["A", a], ["B", b]]);
  const order = resolveTiebreaker([a, b], games, allStandings, { sameDivision: true });
  // A: +50 point diff, B: +20 -- A wins on point differential.
  assert.deepEqual(order, ["A", "B"]);
});

test("resolveTiebreaker is a strict permutation even with zero data (deterministic teamId sort)", () => {
  const a = standing("Z-team", { winPct: 0.5, pf: 100, pa: 100 });
  const b = standing("A-team", { winPct: 0.5, pf: 100, pa: 100 });
  const order = resolveTiebreaker([a, b], new Map(), new Map([["Z-team", a], ["A-team", b]]), { sameDivision: true });
  assert.deepEqual(order, ["A-team", "Z-team"]);
});

test("sortStandingsWithTiebreakers groups by winPct and only tiebreaks within a group", () => {
  const leader = standing("Leader", { winPct: 0.75, pf: 100, pa: 50 });
  const a = standing("A", { winPct: 0.5, pf: 200, pa: 150 });
  const b = standing("B", { winPct: 0.5, pf: 150, pa: 200 });
  const pool = [a, leader, b];
  const allStandings = new Map(pool.map((s) => [s.teamId, s]));
  const sorted = sortStandingsWithTiebreakers(pool, new Map(), allStandings, { sameDivision: true });
  assert.deepEqual(sorted.map((s) => s.teamId), ["Leader", "A", "B"]);
});
