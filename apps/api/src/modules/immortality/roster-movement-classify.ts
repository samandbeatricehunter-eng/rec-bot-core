// Pure classification logic for postRosterMovementForLeague's per-player diff, pulled out of
// roster-movement.service.ts so the actual "is this a trade, a practice-squad move, a release"
// decision is unit-testable without a database -- the rest of that file just needs team names
// and Discord formatting once a kind is decided here.
export type RosterMovementKind = "signed" | "released" | "moved" | "practice_squad_signed" | "practice_squad_released";

export type RosterMovementSlice = { teamId: string | null; isOnPracticeSquad: boolean };

export type RosterMovementClassification = { kind: RosterMovementKind; fromTeamId: string | null; toTeamId: string | null };

/** `prev` undefined means this player wasn't in the last snapshot at all (brand new row).
 * Returns null when there's genuinely nothing to report (no prior state and no team, or the
 * team didn't change at all). */
export function classifyRosterMovement(input: {
  prev: RosterMovementSlice | undefined;
  cur: RosterMovementSlice;
}): RosterMovementClassification | null {
  const { prev, cur } = input;
  if (!prev) {
    if (!cur.teamId) return null;
    return cur.isOnPracticeSquad
      ? { kind: "practice_squad_signed", fromTeamId: null, toTeamId: cur.teamId }
      : { kind: "signed", fromTeamId: null, toTeamId: cur.teamId };
  }
  if (prev.teamId === cur.teamId) return null;
  // A practice-squad claim (either side of the move) is a routine roster transaction in real
  // Madden -- any team can sign a player off another team's practice squad, or release from its
  // own, with no front-office trust required, unlike a real GM-to-GM trade.
  const touchesPracticeSquad = prev.isOnPracticeSquad || cur.isOnPracticeSquad;
  if (!cur.teamId) {
    return touchesPracticeSquad
      ? { kind: "practice_squad_released", fromTeamId: prev.teamId, toTeamId: null }
      : { kind: "released", fromTeamId: prev.teamId, toTeamId: null };
  }
  if (!prev.teamId) {
    return touchesPracticeSquad
      ? { kind: "practice_squad_signed", fromTeamId: null, toTeamId: cur.teamId }
      : { kind: "signed", fromTeamId: null, toTeamId: cur.teamId };
  }
  if (touchesPracticeSquad) return { kind: "practice_squad_signed", fromTeamId: prev.teamId, toTeamId: cur.teamId };
  return { kind: "moved", fromTeamId: prev.teamId, toTeamId: cur.teamId };
}
