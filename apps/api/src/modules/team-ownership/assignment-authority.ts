export type AssignableRoleKey = "member" | "compCommittee" | "commissioner";
export type AssignmentAuthorityToken = "member" | "co_commissioner" | "commissioner";

const DISCORD_NICKNAME_MAX = 32;

/** Parse `rec_team_assignments.notes` (`Authority: commissioner`, optionally with a trailing
 * `; …` comment from league creation). Co-commissioner stays distinct from head commissioner. */
export function parseAssignmentAuthority(notes: string | null | undefined): AssignableRoleKey {
  const raw = String(notes ?? "").replace(/^Authority:\s*/i, "").trim();
  const token = (raw.split(/[;\s,]/)[0] ?? "").toLowerCase();
  if (token === "commissioner") return "commissioner";
  if (token === "co_commissioner") return "compCommittee";
  return "member";
}

export function assignmentAuthorityToken(
  notesOrKey: string | AssignableRoleKey | null | undefined,
): AssignmentAuthorityToken {
  if (notesOrKey === "compCommittee" || notesOrKey === "co_commissioner") return "co_commissioner";
  if (notesOrKey === "commissioner" || notesOrKey === "member") return notesOrKey;
  const key = parseAssignmentAuthority(notesOrKey);
  if (key === "commissioner") return "commissioner";
  if (key === "compCommittee") return "co_commissioner";
  return "member";
}

/** Same suffixes the bot applies on team link (`apps/bot/src/lib/role-sync.ts`). */
export function nicknameAuthoritySuffix(authority: string | AssignableRoleKey | null | undefined): string {
  const token = assignmentAuthorityToken(authority);
  if (token === "commissioner") return " (Commissioner)";
  if (token === "co_commissioner") return " (Co-Commish)";
  return "";
}

export function buildManagedTeamNickname(
  baseNick: string,
  authority: string | AssignableRoleKey | null | undefined,
): string {
  const suffix = nicknameAuthoritySuffix(authority);
  const maxBase = Math.max(1, DISCORD_NICKNAME_MAX - suffix.length);
  const trimmed = String(baseNick ?? "").trim().slice(0, maxBase).trimEnd() || "Team";
  return `${trimmed}${suffix}`;
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
