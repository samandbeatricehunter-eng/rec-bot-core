/** How Advance Readiness decides a rec_game_results row belongs to a week's rec_games row. */

export type AdvanceResultLookupRow = {
  game_id?: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  source: string | null;
  home_score: number | null;
  away_score: number | null;
  season_number?: number | null;
};

/**
 * Prefer the result keyed to this rec_games.id. Fall back to the home/away pair only when
 * that row is also stamped with the league's current season — otherwise a null-season EA
 * import (or a prior season's same matchup) would either hide or leak scores.
 */
export function pickAdvanceResultForGame(
  game: { id: string; home_team_id: string | null; away_team_id: string | null },
  results: AdvanceResultLookupRow[],
  seasonNumber: number,
): AdvanceResultLookupRow | null {
  const byGameId = results.find((row) => row.game_id != null && String(row.game_id) === String(game.id));
  if (byGameId) return byGameId;
  if (!game.home_team_id || !game.away_team_id) return null;
  return results.find((row) =>
    row.home_team_id === game.home_team_id
    && row.away_team_id === game.away_team_id
    && Number(row.season_number) === Number(seasonNumber),
  ) ?? null;
}

export function mergeAdvanceResultRows(
  ...groups: Array<AdvanceResultLookupRow[] | null | undefined>
): AdvanceResultLookupRow[] {
  const merged: AdvanceResultLookupRow[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const row of group ?? []) {
      const key = row.game_id
        ? `game:${row.game_id}`
        : `match:${row.home_team_id}:${row.away_team_id}:${row.season_number ?? "null"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}
