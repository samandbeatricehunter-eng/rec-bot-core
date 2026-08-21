import assert from "node:assert/strict";
import test from "node:test";
import { buildImportAuditWeeks } from "./import-audit.lib.js";

test("flags past weeks with no score and completed games missing stats", () => {
  const weeks = buildImportAuditWeeks({
    currentWeek: 3,
    seasonStage: "regular_season",
    games: [
      {
        game_id: "g1", week_number: 1, status: "scheduled", home_score: null, away_score: null, phase: "regular_season",
        home_team_name: "Home", away_team_name: "Away", has_score: false, has_result: false, team_stat_rows: 0, week_has_player_stats: false,
      },
      {
        game_id: "g2", week_number: 2, status: "completed", home_score: 24, away_score: 17, phase: "regular_season",
        home_team_name: "Chiefs", away_team_name: "Bills", has_score: true, has_result: true, team_stat_rows: 1, week_has_player_stats: false,
      },
      {
        game_id: "g3", week_number: 3, status: "scheduled", home_score: null, away_score: null, phase: "regular_season",
        home_team_name: "Home", away_team_name: "Away", has_score: false, has_result: false, team_stat_rows: 0, week_has_player_stats: false,
      },
    ],
  });

  assert.equal(weeks.length, 3);
  assert.equal(weeks[0]!.issues.some((issue) => issue.kind === "missing_score"), true);
  assert.equal(weeks[1]!.issues.some((issue) => issue.kind === "missing_team_stats"), true);
  assert.equal(weeks[1]!.issues.some((issue) => issue.kind === "missing_player_stats"), true);
  assert.equal(weeks[2]!.issues.some((issue) => issue.kind === "missing_score"), false);
  assert.equal(weeks[2]!.unplayedGames, 1);
});
