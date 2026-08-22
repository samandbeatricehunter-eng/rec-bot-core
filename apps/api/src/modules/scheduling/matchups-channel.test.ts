import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("week advance still edits the stored message instead of posting a copy", () => {
  const plan = planMatchupsChannelWrite({
    stored: { week_number: 7, channel_id: "chan", message_id: "msg-7" },
    channelId: "chan",
  });
  assert.deepEqual(plan, { action: "edit", channelId: "chan", messageId: "msg-7" });
});

test("first post and channel moves are the only times a new Discord message is created", () => {
  assert.deepEqual(planMatchupsChannelWrite({ stored: null, channelId: "chan" }), { action: "post" });
  assert.deepEqual(
    planMatchupsChannelWrite({
      stored: { week_number: 8, channel_id: "old", message_id: "msg-old" },
      channelId: "new",
    }),
    { action: "move", deleteChannelId: "old", deleteMessageId: "msg-old" },
  );
});

test("a failed Discord edit does not fall through to a duplicate post", () => {
  assert.equal(planAfterMatchupsEditAttempt("edited"), "done");
  assert.equal(planAfterMatchupsEditAttempt("missing"), "post");
  assert.equal(planAfterMatchupsEditAttempt("failed"), "abort");
});

test("weekly matchups embed titles are the ones duplicate-sweep is allowed to delete", () => {
  assert.equal(isWeeklyMatchupsEmbedTitle("Season 1, Week 8 Matchups"), true);
  assert.equal(isWeeklyMatchupsEmbedTitle("Season 1, Week 7 Matchups"), true);
  assert.equal(isWeeklyMatchupsEmbedTitle("Week 8 — Confirmed Matchups"), false);
  assert.equal(isWeeklyMatchupsEmbedTitle(null), false);
});
