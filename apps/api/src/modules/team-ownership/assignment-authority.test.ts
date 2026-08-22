import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedTeamNickname, isHeadCommissionerAssignment, parseAssignmentAuthority } from "./assignment-authority.js";

test("parseAssignmentAuthority reads head commissioner even with wizard comments", () => {
  assert.equal(parseAssignmentAuthority("Authority: commissioner"), "commissioner");
  assert.equal(parseAssignmentAuthority("Authority: commissioner; assigned atomically during league creation"), "commissioner");
  assert.equal(parseAssignmentAuthority("Authority: co_commissioner"), "compCommittee");
  assert.equal(parseAssignmentAuthority("Authority: member"), "member");
  assert.equal(parseAssignmentAuthority(null), "member");
});

test("isHeadCommissionerAssignment skips the owner and notes-based commissioner, not co-commish", () => {
  assert.equal(isHeadCommissionerAssignment({ userId: "u1", notes: "Authority: commissioner" }), true);
  assert.equal(isHeadCommissionerAssignment({
    userId: "u1",
    notes: "Authority: commissioner; assigned atomically during league creation",
  }), true);
  assert.equal(isHeadCommissionerAssignment({ userId: "owner", ownerUserId: "owner", notes: "Authority: member" }), true);
  assert.equal(isHeadCommissionerAssignment({ userId: "u2", ownerUserId: "owner", notes: "Authority: co_commissioner" }), false);
  assert.equal(isHeadCommissionerAssignment({ userId: "u3", ownerUserId: "owner", notes: "Authority: member" }), false);
});

test("buildManagedTeamNickname keeps the Co-Commish suffix the bot uses on link", () => {
  assert.equal(buildManagedTeamNickname("Saints", "Authority: co_commissioner"), "Saints (Co-Commish)");
  assert.equal(buildManagedTeamNickname("Saints", "compCommittee"), "Saints (Co-Commish)");
  assert.equal(buildManagedTeamNickname("Saints", "Authority: member"), "Saints");
  assert.equal(buildManagedTeamNickname("Chiefs", "Authority: commissioner"), "Chiefs (Commissioner)");
  assert.equal(buildManagedTeamNickname("A Very Long College Nickname Here", "Authority: co_commissioner").length, 32);
  assert.ok(buildManagedTeamNickname("A Very Long College Nickname Here", "Authority: co_commissioner").endsWith(" (Co-Commish)"));
});
