import assert from "node:assert/strict";
import test from "node:test";
import { playerWeeklyCellsSql } from "./player-stat-source.js";

test("import data mode reads rec_player_weekly_stats", () => {
  const sql = playerWeeklyCellsSql("import", { leagueParam: "$1", extraWhere: " and s.season_number=$2" });
  assert.match(sql, /rec_player_weekly_stats/);
  assert.doesNotMatch(sql, /rec_game_performance_tags/);
  assert.match(sql, /s\.season_number=\$2/);
});

test("box score and manual data modes read performance tags", () => {
  for (const mode of ["box_scores", "manual"] as const) {
    const sql = playerWeeklyCellsSql(mode, { leagueParam: "$1", extraWhere: " and s.week_number = any($2::int[])" });
    assert.match(sql, /rec_game_performance_tags/);
    assert.doesNotMatch(sql, /rec_player_weekly_stats/);
    assert.match(sql, /t\.week_number = any\(\$2::int\[\]\)/);
  }
});
