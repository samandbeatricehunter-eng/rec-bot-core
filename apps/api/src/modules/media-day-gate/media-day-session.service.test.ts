import test from "node:test";
import assert from "node:assert/strict";
import { subjectSatisfied } from "./media-day-session.service.js";

test("subjectSatisfied: a subject that isn't required is always satisfied", () => {
  assert.equal(subjectSatisfied({ required: false, interviewComplete: false, windowClosed: false, challengeIssued: false }), true);
});

test("subjectSatisfied: interview complete but the challenge was never issued is NOT satisfied", () => {
  // This is the exact bug from the 2026-09-15 acceptance-test recording: the old gate only
  // checked interview completion and never looked at challenge issuance at all.
  assert.equal(subjectSatisfied({ required: true, interviewComplete: true, windowClosed: false, challengeIssued: false }), false);
});

test("subjectSatisfied: interview complete AND challenge issued is satisfied", () => {
  assert.equal(subjectSatisfied({ required: true, interviewComplete: true, windowClosed: false, challengeIssued: true }), true);
});

test("subjectSatisfied: a closed window satisfies the subject even with nothing answered or issued", () => {
  assert.equal(subjectSatisfied({ required: true, interviewComplete: false, windowClosed: true, challengeIssued: false }), true);
});

test("subjectSatisfied: not complete, not closed, is never satisfied regardless of challenge state", () => {
  assert.equal(subjectSatisfied({ required: true, interviewComplete: false, windowClosed: false, challengeIssued: true }), false);
});
