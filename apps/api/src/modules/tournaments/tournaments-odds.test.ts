import assert from "node:assert/strict";
import test from "node:test";
import { buildTournamentMatchWagerOptions, resolveTournamentMarket } from "./tournaments-odds.js";

const home = "11111111-1111-4111-8111-111111111111";
const away = "22222222-2222-4222-8222-222222222222";

test("moneyline grades the winner and house-loses a tie", () => {
  assert.equal(resolveTournamentMarket({
    marketKey: "moneyline", pick: home, line: null, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 28, awayScore: 21, winnerUserId: home, boxScore: null,
  }), "won");
  assert.equal(resolveTournamentMarket({
    marketKey: "moneyline", pick: away, line: null, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 21, awayScore: 21, winnerUserId: home, boxScore: null,
  }), "lost");
  assert.equal(resolveTournamentMarket({
    marketKey: "moneyline", pick: away, line: null, wagerKind: "peer",
    homeUserId: home, awayUserId: away, homeScore: 21, awayScore: 21, winnerUserId: home, boxScore: null,
  }), "push");
});

test("spread uses the signed line for the picked side", () => {
  assert.equal(resolveTournamentMarket({
    marketKey: "spread", pick: home, line: -3.5, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 24, awayScore: 20, winnerUserId: home, boxScore: null,
  }), "won");
  assert.equal(resolveTournamentMarket({
    marketKey: "spread", pick: home, line: -7, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 24, awayScore: 20, winnerUserId: home, boxScore: null,
  }), "lost");
});

test("totals and team totals grade from scores; box-score markets void without stats", () => {
  assert.equal(resolveTournamentMarket({
    marketKey: "total_points", pick: "over", line: 40, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 28, awayScore: 17, winnerUserId: home, boxScore: null,
  }), "won");
  assert.equal(resolveTournamentMarket({
    marketKey: "team_total_points_away", pick: "under", line: 20, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 28, awayScore: 17, winnerUserId: home, boxScore: null,
  }), "won");
  assert.equal(resolveTournamentMarket({
    marketKey: "total_yards", pick: "over", line: 600, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 28, awayScore: 17, winnerUserId: home, boxScore: null,
  }), "void");
  assert.equal(resolveTournamentMarket({
    marketKey: "total_yards", pick: "over", line: 600, wagerKind: "house",
    homeUserId: home, awayUserId: away, homeScore: 28, awayScore: 17, winnerUserId: home,
    boxScore: { home: { totalYards: 380 }, away: { totalYards: 250 } },
  }), "won");
});

test("match options include moneyline, spread, and totals", () => {
  const options = buildTournamentMatchWagerOptions({
    matchId: "m1",
    homeUserId: home,
    awayUserId: away,
    homeLabel: "Home",
    awayLabel: "Away",
    bettingOpen: true,
    homeRecord: { wins: 10, losses: 2, pointDifferential: 80, pointsFor: 300, gamesPlayed: 12 },
    awayRecord: { wins: 4, losses: 8, pointDifferential: -40, pointsFor: 200, gamesPlayed: 12 },
  });
  assert.ok(options.markets.some((market) => market.market === "moneyline"));
  assert.ok(options.markets.some((market) => market.market === "spread"));
  assert.ok(options.markets.some((market) => market.market === "total_points"));
  assert.ok(options.markets.some((market) => market.market === "total_yards"));
});
