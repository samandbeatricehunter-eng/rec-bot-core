import { ApiError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { buildImportAuditWeeks, type ImportAuditGame, type ImportAuditReport } from "./import-audit.lib.js";

export type { ImportAuditIssue, ImportAuditIssueKind, ImportAuditReport, ImportAuditWeek } from "./import-audit.lib.js";
export { buildImportAuditWeeks } from "./import-audit.lib.js";

export async function auditEaImportData(guildId: string, leagueId: string): Promise<ImportAuditReport> {
  const context = await getCurrentLeagueContext(guildId);
  if (context.leagueId !== leagueId) throw new ApiError(403, "League does not belong to this server context.");
  if (!String(context.rec_leagues.game ?? "").startsWith("madden")) {
    throw new ApiError(400, "Import audit is available in Madden leagues.");
  }

  const currentWeek = Math.max(1, Number(context.rec_leagues.current_week ?? 1));
  const seasonStage = String(context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "regular_season");
  const includePreseason = seasonStage === "preseason" || seasonStage === "preseason_training_camp";

  const games = await getPgPool().query<ImportAuditGame>(
    `
      select
        g.id as game_id,
        g.week_number,
        g.status,
        g.home_score,
        g.away_score,
        g.phase,
        g.home_team_id,
        g.away_team_id,
        coalesce(nullif(trim(concat_ws(' ', ht.display_city, ht.display_nick)), ''), ht.name, 'Home') as home_team_name,
        coalesce(nullif(trim(concat_ws(' ', at.display_city, at.display_nick)), ''), at.name, 'Away') as away_team_name,
        (g.home_score is not null and g.away_score is not null) as has_score,
        exists (
          select 1 from rec_game_results r
          where r.league_id = g.league_id
            and r.week_number = g.week_number
            and r.home_team_id is not distinct from g.home_team_id
            and r.away_team_id is not distinct from g.away_team_id
        ) as has_result,
        (
          select count(*)::int from rec_team_game_stats s
          where s.league_id = g.league_id
            and s.week_number = g.week_number
            and s.team_id in (g.home_team_id, g.away_team_id)
        ) as team_stat_rows,
        exists (
          select 1 from rec_player_weekly_stats p
          where p.league_id = g.league_id and p.week_number = g.week_number
        ) as week_has_player_stats
      from rec_games g
      left join rec_teams ht on ht.id = g.home_team_id
      left join rec_teams at on at.id = g.away_team_id
      where g.league_id = $1
        and g.week_number between 1 and $2
        and g.week_number <> 22
        and g.home_team_id is not null
        and g.away_team_id is not null
        and (
          ($3::boolean and coalesce(g.phase, 'preseason') = 'preseason')
          or (not $3::boolean and coalesce(g.phase, 'regular_season') <> 'preseason')
        )
      order by g.week_number, g.away_team_id
    `,
    [leagueId, currentWeek, includePreseason],
  );

  const weeks = buildImportAuditWeeks({ currentWeek, seasonStage, games: games.rows });
  return {
    leagueId,
    currentWeek,
    seasonStage,
    weeks,
    issueCount: weeks.reduce((sum, week) => sum + week.issues.length, 0),
  };
}
