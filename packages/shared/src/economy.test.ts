import assert from "node:assert/strict";
import test from "node:test";
import { isPayoutEligibleForGame, isPayoutEligibleForLeague, REC_END_SEASON_PAYOUTS } from "./economy.js";

test("CFB team INT and workhorse stay available in box-score mode", () => {
  const ints = REC_END_SEASON_PAYOUTS.find((item) => item.key === "team_def_ints")!;
  const workhorse = REC_END_SEASON_PAYOUTS.find((item) => item.key === "rb_workhorse")!;
  assert.equal(isPayoutEligibleForLeague(ints, "cfb_27", "box_scores"), true);
  assert.equal(isPayoutEligibleForLeague(workhorse, "cfb_27", "box_scores"), true);
  assert.equal(isPayoutEligibleForGame(workhorse, "madden_27"), false);
});

test("Madden import unlocks player bonuses and team INTs; box scores do not", () => {
  const rb = REC_END_SEASON_PAYOUTS.find((item) => item.key === "madden_rb_workhorse")!;
  const swing = REC_END_SEASON_PAYOUTS.find((item) => item.key === "king_of_the_swing")!;
  const ints = REC_END_SEASON_PAYOUTS.find((item) => item.key === "team_def_ints")!;
  const ppg = REC_END_SEASON_PAYOUTS.find((item) => item.key === "team_ppg")!;
  assert.equal(isPayoutEligibleForLeague(rb, "madden_27", "import"), true);
  assert.equal(isPayoutEligibleForLeague(swing, "madden_27", "import"), true);
  assert.equal(isPayoutEligibleForLeague(ints, "madden_27", "import"), true);
  assert.equal(isPayoutEligibleForLeague(rb, "madden_27", "box_scores"), false);
  assert.equal(isPayoutEligibleForLeague(swing, "madden_27", "box_scores"), false);
  assert.equal(isPayoutEligibleForLeague(ints, "madden_27", "box_scores"), false);
  assert.equal(isPayoutEligibleForLeague(ppg, "madden_27", "box_scores"), true);
  assert.equal(isPayoutEligibleForLeague(ppg, "madden_27", "import"), true);
});
