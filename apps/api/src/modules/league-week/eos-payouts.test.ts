import assert from "node:assert/strict";
import test from "node:test";
import { REC_END_SEASON_PAYOUTS } from "@rec/shared";
import { evalTeamStat, evaluateImportPlayerBonus, mergePlayerWeekStats, pickTrackedImportPlayer } from "./eos-payouts.eval.js";

test("Madden import team INTs read defIntsRec stored as team_interceptions", () => {
  const rows = [
    { defensive_stats: { team_interceptions: 2 }, yards_allowed: 300, off_yards_gained: 350, total_yards_gained: 400 },
    { defensive_stats: { team_interceptions: 1 }, yards_allowed: 280, off_yards_gained: 310, total_yards_gained: 330 },
  ];
  assert.equal(evalTeamStat("team_interceptions", rows, "madden_27"), 1.5);
  assert.equal(evalTeamStat("total_offense_yards", rows, "madden_27"), 330);
});

test("CFB box-score team INTs still use opponent interceptions_thrown", () => {
  const rows = [{ defensive_stats: { interceptions_thrown: 3 } }];
  assert.equal(evalTeamStat("team_interceptions", rows, "cfb_27"), 3);
});

test("Madden RB workhorse requires every EA rushing threshold", () => {
  const definition = REC_END_SEASON_PAYOUTS.find((item) => item.key === "madden_rb_workhorse")!;
  const short = evaluateImportPlayerBonus(definition, {
    rush_attempts: 150, rush_yards: 1000, broken_tackles: 49, rush_yards_after_contact: 250, rush_tds: 10,
  }, "HB");
  assert.equal(short.qualified, false);
  assert.equal(short.eligible, true);
  assert.equal(short.met, 4);
  const full = evaluateImportPlayerBonus(definition, {
    rush_attempts: 150, rush_yards: 1000, broken_tackles: 50, rush_yards_after_contact: 250, rush_tds: 10,
  }, "HB");
  assert.equal(full.qualified, true);
  assert.equal(evaluateImportPlayerBonus(definition, full.detail, "WR").qualified, false);
  assert.equal(evaluateImportPlayerBonus(definition, full.detail, "WR").eligible, false);
});

test("EOS player bonuses never track a defensive player as the workhorse or kicker", () => {
  const workhorse = REC_END_SEASON_PAYOUTS.find((item) => item.key === "madden_rb_workhorse")!;
  const swing = REC_END_SEASON_PAYOUTS.find((item) => item.key === "king_of_the_swing")!;
  const tracked = pickTrackedImportPlayer(workhorse, [
    { position: "CB", playerName: "Christian Gonzalez", stats: { rush_attempts: 0, rush_yards: 0, broken_tackles: 0, rush_yards_after_contact: 0, rush_tds: 0 } },
    { position: "HB", playerName: "Breece Hall", stats: { rush_attempts: 80, rush_yards: 400, broken_tackles: 20, rush_yards_after_contact: 100, rush_tds: 4 } },
    { position: "WR", playerName: "Garrett Wilson", stats: { rush_attempts: 12, rush_yards: 90, broken_tackles: 2, rush_yards_after_contact: 10, rush_tds: 1 } },
  ]);
  assert.equal(tracked?.name, "Breece Hall");
  assert.equal(tracked?.result.met, 0);
  assert.equal(pickTrackedImportPlayer(workhorse, [
    { position: "CB", playerName: "Christian Gonzalez", stats: {} },
  ]), null);
  assert.equal(pickTrackedImportPlayer(swing, [
    { position: "CB", playerName: "Christian Gonzalez", stats: { fg_50_attempts: 0, fg_50_made: 0 } },
    { position: "K", playerName: "Harrison Butker", stats: { fg_50_attempts: 1, fg_50_made: 1 } },
  ])?.name, "Harrison Butker");
});

test("King of the Swing requires two-plus 50 yard attempts at 100 percent", () => {
  const definition = REC_END_SEASON_PAYOUTS.find((item) => item.key === "king_of_the_swing")!;
  assert.equal(evaluateImportPlayerBonus(definition, { fg_50_attempts: 1, fg_50_made: 1 }, "K").qualified, false);
  assert.equal(evaluateImportPlayerBonus(definition, { fg_50_attempts: 2, fg_50_made: 1 }, "K").qualified, false);
  assert.equal(evaluateImportPlayerBonus(definition, { fg_50_attempts: 2, fg_50_made: 2 }, "K").qualified, true);
});

test("player week merge reads both canonical and raw EA keys", () => {
  const totals = mergePlayerWeekStats([
    { stats: { rushBrokenTackles: 4, rushYds: 80, rushAtt: 18 } },
    { stats: { broken_tackles: 6, rush_yards: 90, rush_attempts: 20 } },
  ]);
  assert.equal(totals.broken_tackles, 10);
  assert.equal(totals.rush_yards, 170);
  assert.equal(totals.rush_attempts, 38);
});
