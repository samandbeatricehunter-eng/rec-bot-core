import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseMatchupsKeepId,
  isWeeklyMatchupsEmbedTitle,
  planAfterMatchupsEditAttempt,
  planMatchupsChannelWrite,
  resolveMatchupsChannelId,
} from "./matchups-channel-plan.js";

test("matchups channel prefers the dedicated matchups route over announcements", () => {
  assert.equal(resolveMatchupsChannelId({
    matchups_channel_id: "matchups",
    announcements_channel_id: "announce",
  }), "matchups");
  assert.equal(resolveMatchupsChannelId({ announcements_channel_id: "announce" }), "announce");
  assert.equal(resolveMatchupsChannelId({ matchups_channel_id: "  ", announcements_channel_id: "announce" }), "announce");
  assert.equal(resolveMatchupsChannelId(null), "");
});

test("same week edits the stored message instead of posting a copy", () => {
  const plan = planMatchupsChannelWrite({
    stored: { week_number: 8, channel_id: "chan", message_id: "msg-8" },
    channelId: "chan",
    currentWeek: 8,
  });
  assert.deepEqual(plan, { action: "edit", channelId: "chan", messageId: "msg-8" });
});

test("week advance deletes the old board and posts a replacement", () => {
  const plan = planMatchupsChannelWrite({
    stored: { week_number: 7, channel_id: "chan", message_id: "msg-7" },
    channelId: "chan",
    currentWeek: 8,
  });
  assert.deepEqual(plan, { action: "replace", deleteChannelId: "chan", deleteMessageId: "msg-7" });
});

test("first post and channel moves are the only other times a new Discord message is created", () => {
  assert.deepEqual(
    planMatchupsChannelWrite({ stored: null, channelId: "chan", currentWeek: 8 }),
    { action: "post" },
  );
  assert.deepEqual(
    planMatchupsChannelWrite({
      stored: { week_number: 8, channel_id: "old", message_id: "msg-old" },
      channelId: "new",
      currentWeek: 8,
    }),
    { action: "move", deleteChannelId: "old", deleteMessageId: "msg-old" },
  );
});

test("a failed Discord edit does not fall through to a duplicate post", () => {
  assert.equal(planAfterMatchupsEditAttempt("edited"), "done");
  assert.equal(planAfterMatchupsEditAttempt("missing"), "post");
  assert.equal(planAfterMatchupsEditAttempt("failed"), "abort");
});

test("keep-id prefers the tracked message when it is still in the channel", () => {
  assert.equal(chooseMatchupsKeepId({
    existingIdsNewestFirst: ["newer-dup", "msg-8", "older"],
    preferredId: "msg-8",
  }), "msg-8");
  assert.equal(chooseMatchupsKeepId({
    existingIdsNewestFirst: ["newer-dup", "older"],
    preferredId: "missing",
  }), "newer-dup");
  assert.equal(chooseMatchupsKeepId({
    existingIdsNewestFirst: [],
    preferredId: "msg-8",
  }), null);
});

test("weekly matchups embed titles are the ones duplicate-sweep is allowed to delete", () => {
  assert.equal(isWeeklyMatchupsEmbedTitle("Season 1, Week 8 Matchups"), true);
  assert.equal(isWeeklyMatchupsEmbedTitle("Season 1, Week 7 Matchups"), true);
  assert.equal(isWeeklyMatchupsEmbedTitle("Week 8 — Confirmed Matchups"), false);
  assert.equal(isWeeklyMatchupsEmbedTitle(null), false);
});
