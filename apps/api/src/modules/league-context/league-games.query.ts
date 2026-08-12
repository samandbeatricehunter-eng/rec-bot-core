import type { SupabaseClient, SupabaseQueryBuilder } from "../../lib/supabase.js";

// Canonical, season-scoped access to `rec_games`.
//
// Every season restarts at week 1, so a query filtered only by (league_id, week_number)
// silently pulls in prior seasons' games at the same week number once a league reaches its
// second season — the recurring cross-season leakage bug (GOTW, wagers, odds, highlights,
// the hub hero card, ...). `rec_games` is keyed by `season_id` (there is no `season_number`
// column on it), so routing week/season reads through these helpers makes it impossible to
// forget the season filter: `seasonId` is a required field, not optional context.
//
// The client is passed in (rather than imported) purely so tests can inject an in-memory
// fake; production call sites pass the real `supabase` singleton.

// Only the surface these helpers touch, so a test fake needs to implement just `from`.
export type GamesQueryClient = Pick<SupabaseClient, "from">;

export type LeagueSeasonScope = {
  leagueId: string;
  /** Resolve via resolveSeasonId(leagueId, seasonNumber) — NOT a season_number. */
  seasonId: string;
};

export type LeagueWeekScope = LeagueSeasonScope & { weekNumber: number };

const GAMES_TABLE = "rec_games";

/**
 * Games for one league + season (all weeks). Chain further filters (`.or`, `.order`, ...)
 * on the returned builder as needed.
 */
export function leagueSeasonGamesQuery(
  client: GamesQueryClient,
  scope: LeagueSeasonScope,
  select = "*",
  selectOptions?: { count?: "exact" | string; head?: boolean },
): SupabaseQueryBuilder {
  const base = selectOptions
    ? client.from(GAMES_TABLE).select(select, selectOptions)
    : client.from(GAMES_TABLE).select(select);
  return base.eq("league_id", scope.leagueId).eq("season_id", scope.seasonId);
}

/**
 * Games for one league + season + specific week. Chain further filters on the result.
 */
export function leagueWeekGamesQuery(
  client: GamesQueryClient,
  scope: LeagueWeekScope,
  select = "*",
  selectOptions?: { count?: "exact" | string; head?: boolean },
): SupabaseQueryBuilder {
  return leagueSeasonGamesQuery(
    client,
    { leagueId: scope.leagueId, seasonId: scope.seasonId },
    select,
    selectOptions,
  ).eq("week_number", scope.weekNumber);
}
