import assert from "node:assert/strict";
import test from "node:test";
import {
  autopostAtIso,
  detectStreamPlatform,
  formatMatchupOptionLabel,
  isValidStreamHandle,
  normalizeStreamHandle,
  publicStreamUrl,
  shouldAutopostNow,
} from "./streaming-labels.js";

test("formatMatchupOptionLabel uses away at home - server name", () => {
  assert.equal(
    formatMatchupOptionLabel({ awayTeamName: "Bears", homeTeamName: "Packers", serverName: "REC CFB" }),
    "Bears at Packers - REC CFB",
  );
});

test("formatMatchupOptionLabel truncates to Discord's 100-char select label", () => {
  const label = formatMatchupOptionLabel({
    awayTeamName: "A".repeat(40),
    homeTeamName: "B".repeat(40),
    serverName: "Very Long League Server Name",
  });
  assert.equal(label.length, 100);
  assert.equal(label.endsWith("…"), true);
});

test("publicStreamUrl builds platform watch links", () => {
  assert.equal(publicStreamUrl("twitch", "coachjoe"), "https://www.twitch.tv/coachjoe");
  assert.equal(publicStreamUrl("tiktok", "@coachjoe"), "https://www.tiktok.com/@coachjoe/live");
  assert.match(publicStreamUrl("youtube", "mychannel"), /youtube\.com/);
});

test("normalizeStreamHandle strips @, URLs, and trailing paths", () => {
  assert.equal(normalizeStreamHandle("twitch", "https://www.twitch.tv/CoachJoe"), "coachjoe");
  assert.equal(normalizeStreamHandle("tiktok", "@Coach.Joe/live"), "coach.joe");
  assert.equal(normalizeStreamHandle("youtube", "https://youtube.com/@MyChannel/live"), "MyChannel");
  assert.equal(normalizeStreamHandle("youtube", "UC1234567890abcdefghij"), "UC1234567890abcdefghij");
});

test("isValidStreamHandle accepts platform handles and rejects junk", () => {
  assert.equal(isValidStreamHandle("twitch", "coach_joe"), true);
  assert.equal(isValidStreamHandle("twitch", "ab"), false);
  assert.equal(isValidStreamHandle("youtube", "My-Channel"), true);
  assert.equal(isValidStreamHandle("tiktok", "coach.joe"), true);
  assert.equal(isValidStreamHandle("tiktok", "no spaces"), false);
});

test("detectStreamPlatform recognizes twitch youtube tiktok", () => {
  assert.equal(detectStreamPlatform("https://www.twitch.tv/x"), "twitch");
  assert.equal(detectStreamPlatform("https://youtube.com/watch?v=1"), "youtube");
  assert.equal(detectStreamPlatform("https://www.tiktok.com/@x/live"), "tiktok");
});

test("autopost waits 3 minutes from went-live, or posts immediately if that window already passed", () => {
  const started = Date.parse("2026-08-21T18:00:00.000Z");
  assert.equal(shouldAutopostNow(started, started + 60_000), false);
  assert.equal(shouldAutopostNow(started, started + 3 * 60_000), true);
  assert.equal(autopostAtIso(started, started + 60_000), "2026-08-21T18:03:00.000Z");
  assert.equal(autopostAtIso(started, started + 5 * 60_000), "2026-08-21T18:05:00.000Z");
});
