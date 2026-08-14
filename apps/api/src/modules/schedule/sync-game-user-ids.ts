import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";

/**
 * Keep `rec_games.home_user_id` / `away_user_id` aligned with active team assignments.
 *
 * Schedule seed/import writes those columns from assignments at insert time; when coaches
 * link, unlink, or move teams later the stored IDs go stale. Game-channel create/repair,
 * box-score H2H checks, and other writers still read the columns — so assignment mutations
 * must refresh every game that involves the touched teams (or the whole league).
 */
export async function syncScheduleGameUserIdsForTeams(leagueId: string, teamIds: string[]) {
  const unique = [...new Set(teamIds.filter(Boolean))];
  if (!unique.length) return { updated: 0 };

  try {
    const result = await getPgPool().query(
      `
        update public.rec_games g
        set
          home_user_id = (
            select ta.user_id
            from public.rec_team_assignments ta
            where ta.league_id = $1
              and ta.team_id = g.home_team_id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
            limit 1
          ),
          away_user_id = (
            select ta.user_id
            from public.rec_team_assignments ta
            where ta.league_id = $1
              and ta.team_id = g.away_team_id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
            limit 1
          ),
          updated_at = now()
        where g.league_id = $1
          and (g.home_team_id = any($2::uuid[]) or g.away_team_id = any($2::uuid[]))
      `,
      [leagueId, unique],
    );
    return { updated: result.rowCount ?? 0 };
  } catch (error) {
    throw new ApiError(500, "We couldn't update schedule user links for that team. Please try again.", error);
  }
}

/** Full-league refresh — used after unlink-all or when many teams may have changed. */
export async function syncScheduleGameUserIdsForLeague(leagueId: string) {
  try {
    const result = await getPgPool().query(
      `
        update public.rec_games g
        set
          home_user_id = (
            select ta.user_id
            from public.rec_team_assignments ta
            where ta.league_id = $1
              and ta.team_id = g.home_team_id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
            limit 1
          ),
          away_user_id = (
            select ta.user_id
            from public.rec_team_assignments ta
            where ta.league_id = $1
              and ta.team_id = g.away_team_id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
            limit 1
          ),
          updated_at = now()
        where g.league_id = $1
      `,
      [leagueId],
    );
    return { updated: result.rowCount ?? 0 };
  } catch (error) {
    throw new ApiError(500, "We couldn't update schedule user links for this league. Please try again.", error);
  }
}
