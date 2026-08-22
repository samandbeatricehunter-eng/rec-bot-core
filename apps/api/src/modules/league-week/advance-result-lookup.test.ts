import assert from "node:assert/strict";
import test from "node:test";
import { mergeAdvanceResultRows, pickAdvanceResultForGame } from "./advance-result-lookup.js";

const GAME = { id: "g-week7", home_team_id: "home", away_team_id: "away" };

test("pickAdvanceResultForGame uses the row tied to rec_games.id even when season_number is null", () => {
  const row = {
    game_id: "g-week7",
    home_team_id: "home",
    away_team_id: "away",
    source: "madden_companion_import",
    home_score: 21,
    away_score: 17,
    season_number: null,
  };
  const picked = pickAdvanceResultForGame(GAME, [row], 1);
  assert.equal(picked, row);
});

test("pickAdvanceResultForGame ignores a same-matchup row from another season when game_id does not match", () => {
  const priorSeason = {
    game_id: "g-season1",
    home_team_id: "home",
    away_team_id: "away",
    source: "madden_companion_import",
    home_score: 3,
    away_score: 0,
    season_number: 1,
  };
  assert.equal(pickAdvanceResultForGame({ ...GAME, id: "g-season2" }, [priorSeason], 2), null);
});

test("pickAdvanceResultForGame falls back to home/away only for the requested season", () => {
  const seasonTwo = {
    game_id: null,
    home_team_id: "home",
    away_team_id: "away",
    source: "manual",
    home_score: 14,
    away_score: 10,
    season_number: 2,
  };
  assert.equal(pickAdvanceResultForGame(GAME, [seasonTwo], 1), null);
  assert.equal(pickAdvanceResultForGame(GAME, [seasonTwo], 2), seasonTwo);
});

test("mergeAdvanceResultRows keeps a null-season game_id row alongside a season-scoped query miss", () => {
  const imported = {
    game_id: "g-week7",
    home_team_id: "home",
    away_team_id: "away",
    source: "madden_companion_import",
    home_score: 21,
    away_score: 17,
    season_number: null,
  };
  const merged = mergeAdvanceResultRows([], [imported]);
  assert.deepEqual(merged, [imported]);
});
