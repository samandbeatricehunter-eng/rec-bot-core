/**
 * After an EA roster import, decide which existing rec_players rows to keep.
 *
 * Imported rows themselves are upserted by madden_player_id (update ratings, move
 * team_id, flag free agents). This helper is only for leftover DB rows:
 *   - keep anyone whose numeric EA id is in this import
 *   - keep custom-player-build rows (paid content)
 *   - keep unmatched legend/custom placeholders that have not appeared in the save yet
 *   - drop baseline/seeded players and anyone EA no longer lists
 */
export function isNumericEaPlayerId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^[0-9]+$/.test(id);
}

export function shouldRetainPlayerAfterEaReconcile(
  player: {
    maddenPlayerId: string | null;
    playerSource: string | null;
    isCustomBuild: boolean;
  },
  importedPlayerIds: ReadonlySet<string>,
): boolean {
  if (player.isCustomBuild) return true;
  if (isNumericEaPlayerId(player.maddenPlayerId) && importedPlayerIds.has(player.maddenPlayerId!)) {
    return true;
  }
  if (!isNumericEaPlayerId(player.maddenPlayerId)) {
    const source = player.playerSource ?? "";
    return source === "legend" || source === "custom_player";
  }
  return false;
}
