export type ImportStateSnapshot = {
  completedGames: number;
  playerStatRows: number;
  teamStatRows: number;
  rosterFingerprint: string;
};

export type ImportChangeNote = {
  kind: "scores" | "stats" | "player_movement";
  message: string;
};

export function describeImportChanges(before: ImportStateSnapshot, after: ImportStateSnapshot): ImportChangeNote[] {
  const notes: ImportChangeNote[] = [];
  if (after.completedGames > before.completedGames) {
    const added = after.completedGames - before.completedGames;
    notes.push({ kind: "scores", message: `${added} new score${added === 1 ? "" : "s"} recorded and imported` });
  }
  const statDelta = (after.playerStatRows - before.playerStatRows) + (after.teamStatRows - before.teamStatRows);
  if (statDelta > 0) {
    notes.push({ kind: "stats", message: "New stats recorded and imported" });
  }
  if (after.rosterFingerprint && after.rosterFingerprint !== before.rosterFingerprint) {
    notes.push({ kind: "player_movement", message: "Player movement recorded and imported" });
  }
  return notes;
}
