export type AssignableRoleKey = "member" | "compCommittee" | "commissioner";

/** Parse `rec_team_assignments.notes` (`Authority: commissioner`, optionally with a trailing
 * `; …` comment from league creation). Co-commissioner stays distinct from head commissioner. */
export function parseAssignmentAuthority(notes: string | null | undefined): AssignableRoleKey {
  const raw = String(notes ?? "").replace(/^Authority:\s*/i, "").trim();
  const token = (raw.split(/[;\s,]/)[0] ?? "").toLowerCase();
  if (token === "commissioner") return "commissioner";
  if (token === "co_commissioner") return "compCommittee";
  return "member";
}

/** Head commissioner = league owner, or an assignment whose notes say Authority: commissioner.
 * Co-commissioners are not included — Discord can usually rename those members. */
export function isHeadCommissionerAssignment(input: {
  notes?: string | null;
  userId: string;
  ownerUserId?: string | null;
}): boolean {
  if (input.ownerUserId && input.userId === input.ownerUserId) return true;
  return parseAssignmentAuthority(input.notes) === "commissioner";
}
