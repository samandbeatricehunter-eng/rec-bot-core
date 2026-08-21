import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompanionPayload } from "./madden-companion.adapters.js";

test("player stats record keys are per player, not per shared game id", () => {
  const records = normalizeCompanionPayload("player_stats", {
    playerPassingStatInfoList: [
      { rosterId: 11, teamId: 1, scheduleId: 555, week: 1, statCategory: "passing", passYds: 250, id: 0 },
      { rosterId: 22, teamId: 2, scheduleId: 555, week: 1, statCategory: "passing", passYds: 180, id: 0 },
    ],
  });
  assert.equal(records.length, 2);
  assert.notEqual(records[0]?.recordKey, records[1]?.recordKey);
  assert.equal(records[0]?.recordKey, "11:555:passing");
  assert.equal(records[1]?.recordKey, "22:555:passing");
});

test("player stats in the same week without a game id still key off roster id", () => {
  const records = normalizeCompanionPayload("player_stats", {
    playerRushingStatInfoList: [
      { rosterId: 11, teamId: 1, week: 1, statCategory: "rushing", rushYds: 90 },
      { rosterId: 22, teamId: 2, week: 1, statCategory: "rushing", rushYds: 40 },
    ],
  });
  assert.equal(records[0]?.recordKey, "11:week-1:rushing");
  assert.equal(records[1]?.recordKey, "22:week-1:rushing");
});

test("team stats record keys are per team, not per shared game id", () => {
  const records = normalizeCompanionPayload("team_stats", {
    teamStatInfoList: [
      { teamId: 1, scheduleId: 555, week: 1, offYds: 400, id: 0 },
      { teamId: 2, scheduleId: 555, week: 1, offYds: 310, id: 0 },
    ],
  });
  assert.equal(records.length, 2);
  assert.notEqual(records[0]?.recordKey, records[1]?.recordKey);
  assert.equal(records[0]?.recordKey, "1:555:all");
  assert.equal(records[1]?.recordKey, "2:555:all");
});

test("schedule rows still use scheduleId as the record key", () => {
  const records = normalizeCompanionPayload("schedule", {
    gameScheduleInfoList: [
      { scheduleId: 555, homeTeamId: 1, awayTeamId: 2, week: 1, homeScore: 24, awayScore: 17 },
      { scheduleId: 556, homeTeamId: 3, awayTeamId: 4, week: 1, homeScore: 10, awayScore: 13 },
    ],
  });
  assert.equal(records[0]?.recordKey, "555");
  assert.equal(records[1]?.recordKey, "556");
});
