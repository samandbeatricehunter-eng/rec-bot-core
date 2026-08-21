import assert from "node:assert/strict";
import test from "node:test";
import { asPercentInt, madeAttempts, mapEaTeamWeeklyStats } from "./team-stats-map.js";

const LIVE_WEEKLY = {
  seed: 6,
  week: 1,
  statId: 538313003,
  tODiff: 1,
  teamId: 777781273,
  defSacks: 5,
  offSacks: 8,
  defFumRec: 0,
  isPlayoff: false,
  off2PtAtt: 0,
  penalties: 1,
  totalTies: 0,
  totalWins: 4,
  weekIndex: 0,
  weekLabel: "Week 1",
  defIntsRec: 1,
  defPassYds: 364,
  defRushYds: 140,
  off2PtConv: 0,
  offFumLost: 0,
  offPassTDs: 1,
  offPassYds: 160,
  offRushTDs: 1,
  offRushYds: 115,
  penaltyYds: 5,
  scheduleId: 545783869,
  seasonYear: 2026,
  stageIndex: 1,
  defRedZones: 6,
  defTotalYds: 504,
  off1stDowns: 11,
  offIntsLost: 0,
  offRedZones: 2,
  offTotalYds: 275,
  seasonIndex: 0,
  tOGiveaways: 0,
  tOTakeaways: 1,
  totalLosses: 2,
  defForcedFum: 0,
  defPtsPerGame: 30.8333,
  defRedZoneFGs: 1,
  defRedZonePct: 33.3333,
  defRedZoneTDs: 1,
  off2PtConvPct: 0,
  off3rdDownAtt: 14,
  off4thDownAtt: 3,
  offPtsPerGame: 32,
  offRedZoneFGs: 0,
  offRedZonePct: 0,
  offRedZoneTDs: 0,
  off3rdDownConv: 5,
  off4thDownConv: 1,
  off3rdDownConvPct: 35.7143,
  off4thDownConvPct: 33.3333,
  offTotalYdsGained: 431,
};

test("maps live EA weekly keys onto dedicated columns, not the box-score names", () => {
  const mapped = mapEaTeamWeeklyStats({
    payload: LIVE_WEEKLY,
    teamId: "team-a",
    game: {
      home_team_id: "team-a",
      away_team_id: "team-b",
      home_score: 41,
      away_score: 14,
    },
  });
  assert.equal(mapped.off_pass_yards, 160);
  assert.equal(mapped.off_rush_yards, 115);
  assert.equal(mapped.off_yards_gained, 275);
  assert.equal(mapped.total_yards_gained, 431);
  assert.equal(mapped.off_first_down, 11);
  assert.equal(mapped.pass_yards_allowed, 364);
  assert.equal(mapped.rush_yards_allowed, 140);
  assert.equal(mapped.yards_allowed, 504);
  assert.equal(mapped.turnovers_committed, 0);
  assert.equal(mapped.generated_turnovers, 1);
  assert.equal(mapped.red_zone_off_percentage, 0);
  assert.equal(mapped.red_zone_def_percentage, 33);
  assert.equal(mapped.points_for, 41);
  assert.equal(mapped.points_against, 14);
  assert.equal(mapped.result, "win");
  assert.equal(mapped.is_home, true);
  assert.equal(mapped.offensive_stats.third_down_conversions, "5-14");
  assert.equal(mapped.offensive_stats.fourth_down_conversions, "1-3");
  assert.equal(mapped.offensive_stats.penalties, 1);
  assert.equal(mapped.offensive_stats.red_zone_tds, 0);
  assert.equal(mapped.defensive_stats.team_interceptions, 1);
  assert.equal(mapped.defensive_stats.team_sacks, 5);
  assert.equal(mapped.offensive_stats.offPtsPerGame, undefined);
  assert.equal(mapped.offensive_stats.totalWins, undefined);
});

test("prefers rec_games scores and only sets home when home_team_id is known", () => {
  const unknownHome = mapEaTeamWeeklyStats({
    payload: { ...LIVE_WEEKLY, pointsFor: 99 },
    teamId: "team-a",
    game: { home_team_id: null, away_team_id: "team-b", home_score: null, away_score: null },
  });
  assert.equal(unknownHome.is_home, false);
  assert.equal(unknownHome.points_for, 99);
  assert.equal(unknownHome.result, null);
});

test("percent helper treats 0 as a real 0% and scales 0-1 fractions", () => {
  assert.equal(asPercentInt(0), 0);
  assert.equal(asPercentInt(33.3333), 33);
  assert.equal(asPercentInt(0.75), 75);
  assert.equal(madeAttempts(5, 14), "5-14");
  assert.equal(madeAttempts(null, 14), null);
});
