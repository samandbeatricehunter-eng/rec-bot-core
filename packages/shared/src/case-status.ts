// Commissioner Command Center case display status. rec_commissioners_inbox only stores a
// terminal-leaning status column (pending/approved/denied/cancelled/resolved/...); the richer
// in-flight states (New/Under Review/Voting/Waiting on User) are derived from the additive
// flags added alongside cases (internal_memo, voting_topic_id, awaiting_user_response) rather
// than stored as their own column, so every existing writer of rec_commissioners_inbox keeps
// working without knowing this vocabulary exists.
export type CaseDisplayStatus =
  | "New"
  | "Under Review"
  | "Voting"
  | "Waiting on User"
  | "Approved"
  | "Denied"
  | "Cancelled"
  | "Resolved";

const TERMINAL_RESOLVED_STATUSES = new Set(["resolved", "issued", "fulfilled", "settled", "completed"]);

export function deriveCaseDisplayStatus(input: {
  status: string;
  internalMemo?: string | null;
  votingTopicId?: string | null;
  awaitingUserResponse?: boolean | null;
}): CaseDisplayStatus {
  const status = String(input.status ?? "").toLowerCase();
  if (status === "approved") return "Approved";
  if (status === "denied") return "Denied";
  if (status === "cancelled") return "Cancelled";
  if (TERMINAL_RESOLVED_STATUSES.has(status)) return "Resolved";
  // Anything still open (pending, or any other non-terminal value) — derive the sub-state.
  if (input.votingTopicId) return "Voting";
  if (input.awaitingUserResponse) return "Waiting on User";
  if (input.internalMemo && input.internalMemo.trim()) return "Under Review";
  return "New";
}

export const CASE_STATUS_BADGE: Record<CaseDisplayStatus, "pending" | "approved" | "denied" | "info" | "locked"> = {
  New: "pending",
  "Under Review": "info",
  Voting: "info",
  "Waiting on User": "pending",
  Approved: "approved",
  Denied: "denied",
  Cancelled: "denied",
  Resolved: "locked",
};
