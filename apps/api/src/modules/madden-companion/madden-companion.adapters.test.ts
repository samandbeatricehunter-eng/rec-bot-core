import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompanionPayload } from "./madden-companion.adapters.js";

test("player stats record keys are per player, not per shared game id", () => {
  const records = normalizeCompanionPayload("player_stats", {
    playerPassingStatInfoList: [
      { rosterId: 11, teamId: 1, scheduleId: 555, week: 1, stageIndex: 1, seasonYear: 2026, statCategory: "passing", passYds: 250, id: 0 },
      { rosterId: 22, teamId: 2, scheduleId: 555, week: 1, stageIndex: 1, seasonYear: 2026, statCategory: "passing", passYds: 180, id: 0 },
    ],
  });
  assert.equal(records.length, 2);
  assert.notEqual(records[0]?.recordKey, records[1]?.recordKey);
  assert.equal(records[0]?.recordKey, "s2026-st1-w1-11-555-passing");
  assert.equal(records[1]?.recordKey, "s2026-st1-w1-22-555-passing");
});

test("player stats in the same week without a game id still key off roster id", () => {
  const records = normalizeCompanionPayload("player_stats", {
    playerRushingStatInfoList: [
      { rosterId: 11, teamId: 1, week: 1, stageIndex: 1, seasonYear: 2026, statCategory: "rushing", rushYds: 90 },
      { rosterId: 22, teamId: 2, week: 1, stageIndex: 1, seasonYear: 2026, statCategory: "rushing", rushYds: 40 },
    ],
  });
  assert.equal(records[0]?.recordKey, "s2026-st1-w1-11-nogame-rushing");
  assert.equal(records[1]?.recordKey, "s2026-st1-w1-22-nogame-rushing");
});

test("the same player and scheduleId in two weeks do not share a companion key", () => {
  const week1 = normalizeCompanionPayload("player_stats", {
    playerPassingStatInfoList: [
      { rosterId: 11, teamId: 1, scheduleId: 555, week: 1, weekIndex: 0, stageIndex: 1, seasonYear: 2026, statCategory: "passing", passYds: 250 },
    ],
  });
  const week2 = normalizeCompanionPayload("player_stats", {
    playerPassingStatInfoList: [
      { rosterId: 11, teamId: 1, scheduleId: 555, week: 2, weekIndex: 1, stageIndex: 1, seasonYear: 2026, statCategory: "passing", passYds: 180 },
    ],
  });
  assert.equal(week1[0]?.recordKey, "s2026-st1-w1-11-555-passing");
  assert.equal(week2[0]?.recordKey, "s2026-st1-w2-11-555-passing");
  assert.notEqual(week1[0]?.recordKey, week2[0]?.recordKey);
  assert.equal(week1[0]?.weekNumber, 1);
  assert.equal(week1[0]?.sourceWeekIndex, 0);
  assert.equal(week2[0]?.weekNumber, 2);
  assert.equal(week2[0]?.sourceWeekIndex, 1);
});

test("team stats record keys are per team, not per shared game id", () => {
  const records = normalizeCompanionPayload("team_stats", {
    teamStatInfoList: [
      { teamId: 1, scheduleId: 555, week: 1, stageIndex: 1, seasonYear: 2026, offYds: 400, id: 0 },
      { teamId: 2, scheduleId: 555, week: 1, stageIndex: 1, seasonYear: 2026, offYds: 310, id: 0 },
    ],
  });
  assert.equal(records.length, 2);
  assert.notEqual(records[0]?.recordKey, records[1]?.recordKey);
  assert.equal(records[0]?.recordKey, "s2026-st1-w1-1-555-all");
  assert.equal(records[1]?.recordKey, "s2026-st1-w1-2-555-all");
});

test("schedule rows include week so reused scheduleIds do not collide", () => {
  const week1 = normalizeCompanionPayload("schedule", {
    gameScheduleInfoList: [
      { scheduleId: 555, homeTeamId: 1, awayTeamId: 2, week: 1, stageIndex: 1, seasonYear: 2026, homeScore: 24, awayScore: 17 },
    ],
  });
  const week2 = normalizeCompanionPayload("schedule", {
    gameScheduleInfoList: [
      { scheduleId: 555, homeTeamId: 3, awayTeamId: 4, week: 2, stageIndex: 1, seasonYear: 2026, homeScore: 10, awayScore: 13 },
    ],
  });
  assert.equal(week1[0]?.recordKey, "s2026-st1-w1-game-555-schedule");
  assert.equal(week2[0]?.recordKey, "s2026-st1-w2-game-555-schedule");
  assert.notEqual(week1[0]?.recordKey, week2[0]?.recordKey);
});
