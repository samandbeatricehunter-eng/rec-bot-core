import test from "node:test";
import assert from "node:assert/strict";
import { classifyReplyTone, moveForReplyTone } from "./reply-tone.js";

test("classifyReplyTone recognizes defiant replies", () => {
  assert.equal(classifyReplyTone("watch, we'll see who's laughing after Sunday"), "defiant");
  assert.equal(classifyReplyTone("bet. bring it, anytime."), "defiant");
  assert.equal(classifyReplyTone("Book it, this isn't over."), "defiant");
});

test("classifyReplyTone recognizes mocking replies", () => {
  assert.equal(classifyReplyTone("lol ok buddy, sit down"), "mocking");
  assert.equal(classifyReplyTone("that's embarrassing, stay in your lane"), "mocking");
  assert.equal(classifyReplyTone("no cap you're cooked"), "mocking");
});

test("classifyReplyTone recognizes conciliatory replies", () => {
  assert.equal(classifyReplyTone("Respect, that was well played honestly"), "conciliatory");
  assert.equal(classifyReplyTone("fair, my bad, you earned that one"), "conciliatory");
  assert.equal(classifyReplyTone("Props to your guys, well deserved win"), "conciliatory");
});

test("classifyReplyTone recognizes dismissive replies", () => {
  assert.equal(classifyReplyTone("don't care, moving on"), "dismissive");
  assert.equal(classifyReplyTone("whatever, not worth my time"), "dismissive");
  assert.equal(classifyReplyTone("who cares, next"), "dismissive");
});

test("classifyReplyTone defaults to neutral with no keyword match", () => {
  assert.equal(classifyReplyTone("We play again in week 12."), "neutral");
  assert.equal(classifyReplyTone(""), "neutral");
});

test("classifyReplyTone prioritizes mocking/defiant over dismissive/conciliatory on mixed signals", () => {
  // Contains both a dismissive phrase ("whatever") and a mocking one ("lol") -- mocking should win.
  assert.equal(classifyReplyTone("whatever, lol, cute try though"), "mocking");
});

test("moveForReplyTone maps every tone to a real SocialClaimMove", () => {
  assert.equal(moveForReplyTone("mocking"), "receipt");
  assert.equal(moveForReplyTone("defiant"), "receipt");
  assert.equal(moveForReplyTone("dismissive"), "compare");
  assert.equal(moveForReplyTone("conciliatory"), "interpret");
  assert.equal(moveForReplyTone("neutral"), "report");
});
