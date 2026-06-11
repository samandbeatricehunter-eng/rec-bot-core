import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedStats, resolveCanonicalKey, readStat } from "./stat-normalizer.js";
import { formatStatValue, getStatLabel } from "./index.js";

test("basic offensive alias matching", () => {
  assert.equal(resolveCanonicalKey("passYards", "player", "passing"), "pass_yards");
  assert.equal(resolveCanonicalKey("rushYards", "player", "rushing"), "rush_yards");
  assert.equal(resolveCanonicalKey("recYards", "player", "receiving"), "receiving_yards");
  assert.equal(resolveCanonicalKey("passTDs", "player", "passing"), "pass_tds");
  assert.equal(resolveCanonicalKey("rushTDs", "player", "rushing"), "rush_tds");
  assert.equal(resolveCanonicalKey("recTDs", "player", "receiving"), "receiving_tds");
});

test("snake_case and camelCase both resolve", () => {
  assert.equal(resolveCanonicalKey("pass_yds", "player", "passing"), "pass_yards");
  assert.equal(resolveCanonicalKey("rushing_yds", "player", "rushing"), "rush_yards");
  assert.equal(resolveCanonicalKey("rec_yds", "player", "receiving"), "receiving_yards");
});

test("context-sensitive: interceptions", () => {
  // player passing → thrown
  assert.equal(resolveCanonicalKey("interceptions", "player", "passing"), "interceptions_thrown");
  // player defense → defensive INT
  assert.equal(resolveCanonicalKey("interceptions", "player", "defense"), "interceptions");
  // team defense → team INT
  assert.equal(resolveCanonicalKey("interceptions", "team", "team_defense"), "team_interceptions");
  // explicit unambiguous aliases still work
  assert.equal(resolveCanonicalKey("passInts", "player", "passing"), "interceptions_thrown");
  assert.equal(resolveCanonicalKey("defInts", "player", "defense"), "interceptions");
});

test("context-sensitive: sacks", () => {
  assert.equal(resolveCanonicalKey("sacks", "player", "passing"), "sacks_taken");
  assert.equal(resolveCanonicalKey("sacks", "player", "defense"), "sacks");
  assert.equal(resolveCanonicalKey("sacks", "team", "team_defense"), "team_sacks");
});

test("context-sensitive: team vs player yards", () => {
  assert.equal(resolveCanonicalKey("passYards", "team", "team_offense"), "team_pass_yards");
  assert.equal(resolveCanonicalKey("rushYards", "team", "team_offense"), "team_rush_yards");
});

test("game scope: generic score keys do not map, explicit ones do", () => {
  assert.equal(resolveCanonicalKey("score", "game", "game_result"), null);
  assert.equal(resolveCanonicalKey("homeScore", "game", "game_result"), "home_score");
  assert.equal(resolveCanonicalKey("awayScore", "game", "game_result"), "away_score");
});

test("normalizeImportedStats: maps known keys, surfaces unknown, converts numeric strings", () => {
  const result = normalizeImportedStats({
    scope: "player",
    statCategory: "passing",
    stats: { passYds: "4123", passTDs: 33, interceptions: 9, somethingWeird: 5 },
    rawPayload: { fullName: "Test QB", position: "QB" }
  });
  assert.equal(result.canonicalStats.pass_yards, 4123); // numeric string → number
  assert.equal(result.canonicalStats.pass_tds, 33);
  assert.equal(result.canonicalStats.interceptions_thrown, 9); // context-sensitive
  assert.equal(result.unmappedStats.somethingWeird, 5);
  // identity fields are not stats and are not surfaced as unmapped
  assert.equal("fullName" in result.unmappedStats, false);
  assert.equal("position" in result.unmappedStats, false);
  assert.equal(result.rawAliasesUsed.passYds, "pass_yards");
});

test("normalizeImportedStats: never throws on nested / odd values", () => {
  const result = normalizeImportedStats({
    scope: "team",
    statCategory: "team_defense",
    stats: { sacks: 41, nested: { a: 1 }, list: [1, 2, 3], pointsAllowed: 280 }
  });
  assert.equal(result.canonicalStats.team_sacks, 41);
  assert.equal(result.canonicalStats.points_allowed, 280);
  // nested/array values are ignored, not crashed on
  assert.equal("nested" in result.canonicalStats, false);
});

test("readStat: backward compatible with legacy raw keys and canonical keys", () => {
  // legacy stored data (raw EA keys)
  assert.equal(readStat({ passYds: 4500 }, "pass_yards"), 4500);
  assert.equal(readStat({ defSacks: 12 }, "sacks"), 12);
  // new canonical stored data
  assert.equal(readStat({ pass_yards: 4500 }, "pass_yards"), 4500);
  // absent → 0
  assert.equal(readStat({}, "pass_yards"), 0);
  assert.equal(readStat(null, "pass_yards"), 0);
});

test("formatStatValue and labels", () => {
  assert.equal(formatStatValue("pass_yards", 4123), "4,123 yds");
  assert.equal(formatStatValue("points_for", 35), "35 pts");
  assert.equal(formatStatValue("fg_pct", 87.5), "87.5%");
  assert.equal(formatStatValue("yards_per_carry", 5.25), "5.3");
  assert.equal(getStatLabel("pass_yards"), "Passing Yards");
});
