import assert from "node:assert/strict";
import test from "node:test";
import { hasFailureToScheduleWaitElapsed, isGameChannelQuietHours, isTransientGameSchedulingMessage, qualifiesForSchedulingPayoutBonus } from "./scheduling-guardrails.js";

test("game-channel quiet hours use Central time and end at 6 AM", () => {
  assert.equal(isGameChannelQuietHours(new Date("2026-08-21T05:00:00Z")), true); // midnight CDT
  assert.equal(isGameChannelQuietHours(new Date("2026-08-21T10:59:59Z")), true); // 5:59 AM CDT
  assert.equal(isGameChannelQuietHours(new Date("2026-08-21T11:00:00Z")), false); // 6:00 AM CDT
  assert.equal(isGameChannelQuietHours(new Date("2026-01-21T06:00:00Z")), true); // midnight CST
  assert.equal(isGameChannelQuietHours(new Date("2026-01-21T12:00:00Z")), false); // 6:00 AM CST
});

test("failure-to-schedule wait starts at the requesting coach's first outreach", () => {
  const outreach = "2026-08-21T13:00:00.000Z";
  assert.equal(hasFailureToScheduleWaitElapsed(outreach, null, "Etc/UTC", new Date("2026-08-21T20:59:59.999Z").getTime()), false);
  assert.equal(hasFailureToScheduleWaitElapsed(outreach, null, "Etc/UTC", new Date("2026-08-21T21:00:00.000Z").getTime()), true);
  assert.equal(hasFailureToScheduleWaitElapsed(outreach, "2026-08-21T14:00:00.000Z", "Etc/UTC", new Date("2026-08-22T21:00:00.000Z").getTime()), false);
  assert.equal(hasFailureToScheduleWaitElapsed(null, null, "Etc/UTC", new Date("2026-08-22T21:00:00.000Z").getTime()), false);
});

test("failure-to-schedule wait pauses during the recipient's local midnight-7AM", () => {
  // Outreach at 11 PM Central (2026-08-22T04:00Z is midnight CDT) -- the 8h clock should not
  // finish by 7 AM Central the same wait would otherwise reach, because the whole midnight-7AM
  // window doesn't count.
  const outreach = "2026-08-22T04:00:00.000Z"; // 11 PM CDT on 2026-08-21
  assert.equal(hasFailureToScheduleWaitElapsed(outreach, null, "America/Chicago", new Date("2026-08-22T12:00:00.000Z").getTime()), false); // 8h of wall time (11PM-7AM), but only 1h counts (11PM-midnight)
  assert.equal(hasFailureToScheduleWaitElapsed(outreach, null, "America/Chicago", new Date("2026-08-22T19:00:00.000Z").getTime()), true); // 15h of wall time (11PM-2PM); 1h (11PM-midnight) + 7h (7AM-2PM) = 8h counted
});

test("scheduling payout bonus requires a confirmed time and game-over", () => {
  const complete = { confirmedAt: "2026-08-21T13:00:00.000Z", homeUserId: "home", awayUserId: "away", markedOver: true };
  assert.equal(qualifiesForSchedulingPayoutBonus(complete), true);
  assert.equal(qualifiesForSchedulingPayoutBonus({ ...complete, confirmedAt: null }), false);
  assert.equal(qualifiesForSchedulingPayoutBonus({ ...complete, markedOver: false }), false);
});

test("scheduling cleanup preserves humans and original embeds", () => {
  const botId = "bot";
  assert.equal(isTransientGameSchedulingMessage({ id: "human", author: { id: "coach" }, content: "proposed 8 PM", mentions: [{}] }, botId), false);
  assert.equal(isTransientGameSchedulingMessage({ id: "intro", author: { id: botId }, content: "<@coach>", mentions: [{}], embeds: [{}] }, botId), false);
  assert.equal(isTransientGameSchedulingMessage({ id: "panel", author: { id: botId }, embeds: [{}], components: [{ components: [{ custom_id: "rec:gamesched:panel:propose:game" }] }] }, botId), false);
});

test("scheduling cleanup selects REC pings and offer/response traffic", () => {
  const botId = "bot";
  assert.equal(isTransientGameSchedulingMessage({ id: "ping", author: { id: botId }, content: "<@coach> — schedule a time", mentions: [{}] }, botId), true);
  assert.equal(isTransientGameSchedulingMessage({ id: "offer", author: { id: botId }, content: "respond below", components: [{ components: [{ custom_id: "rec:gamesched:accept:game" }] }] }, botId), true);
  assert.equal(isTransientGameSchedulingMessage({ id: "resolved", author: { id: botId }, content: "✅ Accepted — kickoff scheduled." }, botId), true);
});
