/**
 * After an EA roster import, decide which existing rec_players rows to keep.
 *
 * The EA payload is the source of truth over baseline seeds, name placeholders,
 * and unpaid-content rows that are not in this save. Imported rows themselves
 * are upserted by madden_player_id (ratings, team moves, free-agent flags).
 * This helper is only for leftover DB rows: keep a player if and only if their
 * numeric EA id appears in this import.
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
  return isNumericEaPlayerId(player.maddenPlayerId) && importedPlayerIds.has(player.maddenPlayerId!);
}

/**
 * Name+team placeholder adoption rewrites madden_player_id onto an existing seeded row.
 * If this numeric EA id already belongs to another row, that UPDATE hits
 * rec_players_league_id_madden_player_id_key. Only adopt when the id is still free;
 * otherwise the upcoming INSERT … ON CONFLICT updates the existing EA row, and
 * reconcile drops the leftover placeholder.
 */
export function shouldAdoptNamePlaceholder(
  existingNumericEaIds: ReadonlySet<string>,
  rosterId: string,
): boolean {
  return !existingNumericEaIds.has(rosterId);
}
