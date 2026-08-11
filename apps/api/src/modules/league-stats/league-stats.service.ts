import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

/** Core query, keyed by leagueId directly — reused by the authenticated guildId-based route
 * and by the public demo-league preview (which has no Discord guild/session context). */
export async function getLeagueStatsForLeagueId(leagueId: string, input: { teamId?: string | null; position?: string | null } = {}) {
  const leagueResult = await getPgPool().query<{ id: string; name: string; game: string; season_number: number }>(
    "select id,name,game,season_number from rec_leagues where id=$1", [leagueId],
  );
  const league = leagueResult.rows[0];
  const teamsResult = await getPgPool().query<{ id: string; name: string; abbreviation: string | null; conference: string | null; division: string | null }>(
    "select id,name,abbreviation,conference,division from rec_teams where league_id=$1 and coalesce(is_schedule_placeholder,false)=false order by name", [leagueId],
  );
  const params: unknown[] = [leagueId, league.season_number];
  let filter = "";
  if (input.teamId) { params.push(input.teamId); filter += ` and p.team_id=$${params.length}`; }
  if (input.position) { params.push(input.position); filter += ` and upper(p.position)=upper($${params.length})`; }

  // No column cap here — every numeric stat total for every player comes back, and the client
  // picks which columns to actually render based on the selected position (see
  // statCategoriesForPosition / statKeysForCategories in @rec/shared). Capping to "top 16 most
  // frequent" server-side used to silently drop a real stat just because it was rare across
  // the currently-filtered player set.
  const playersResult = await getPgPool().query(
    `with numeric_stats as (
       select s.player_id,e.key,sum(e.value::numeric) as total
       from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
       where s.league_id=$1 and s.season_number=$2 and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
       group by s.player_id,e.key
     ), totals as (
       select player_id,jsonb_object_agg(key,total order by key) as stats from numeric_stats group by player_id
     )
     select p.id,p.full_name as "fullName",p.position,p.jersey_number as "jerseyNumber",p.photo_url as "photoUrl",
            p.dev_trait as "devTrait",p.team_id as "teamId",t.name as "teamName",t.abbreviation as "teamAbbreviation",
            coalesce(x.stats,'{}'::jsonb) as stats
       from rec_players p left join rec_teams t on t.id=p.team_id left join totals x on x.player_id=p.id
      where p.league_id=$1 and coalesce(p.roster_status,'active')='active' ${filter}
      order by t.name nulls last,p.position,p.full_name limit 1000`,
    params,
  );
  const leadersResult = await getPgPool().query(
    `with numeric_stats as (
       select s.player_id,e.key,sum(e.value::numeric) as total
       from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
       where s.league_id=$1 and s.season_number=$2 and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
       group by s.player_id,e.key
     ), ranked as (
       select n.*,row_number() over(partition by n.key order by n.total desc,p.full_name) as rank,
              p.full_name,p.position,t.name as team_name,t.abbreviation as team_abbreviation
       from numeric_stats n join rec_players p on p.id=n.player_id left join rec_teams t on t.id=p.team_id
     )
     select key,jsonb_agg(jsonb_build_object('playerId',player_id,'playerName',full_name,'position',position,
       'teamName',team_name,'teamAbbreviation',team_abbreviation,'value',total,'rank',rank) order by rank) as leaders
     from ranked where rank<=5 group by key order by key`,
    [leagueId, league.season_number],
  );
  return {
    league,
    teams: teamsResult.rows,
    positions: [...new Set(playersResult.rows.map((row: any) => row.position).filter(Boolean))].sort(),
    players: playersResult.rows,
    leaders: Object.fromEntries(leadersResult.rows.map((row: any) => [row.key, row.leaders])),
  };
}

export async function getLeagueStats(input: { guildId: string; teamId?: string | null; position?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  return getLeagueStatsForLeagueId(context.leagueId, input);
}

const TEAM_STAT_COLUMNS: Array<[canonicalKey: string, sqlSum: string]> = [
  ["points_for", "coalesce(sum(g.points_for),0)"],
  ["points_allowed", "coalesce(sum(g.points_against),0)"],
  ["total_offense_yards", "coalesce(sum(g.off_yards_gained),0)"],
  ["team_pass_yards", "coalesce(sum(g.off_pass_yards),0)"],
  ["team_rush_yards", "coalesce(sum(g.off_rush_yards),0)"],
  ["first_downs", "coalesce(sum(g.off_first_down),0)"],
  ["turnovers", "coalesce(sum(g.turnovers_committed),0)"],
  ["takeaways", "coalesce(sum(g.generated_turnovers),0)"],
  ["total_yards_allowed", "coalesce(sum(g.yards_allowed),0)"],
  ["pass_yards_allowed", "coalesce(sum(g.pass_yards_allowed),0)"],
  ["rush_yards_allowed", "coalesce(sum(g.rush_yards_allowed),0)"],
  ["games_played", "count(g.id)"],
];

/** Team-level season totals for every team in the league (including teams with zero games
 * played, so a brand-new season still lists every team at 0 rather than omitting them). */
export async function getLeagueTeamStatsForLeagueId(leagueId: string) {
  const leagueResult = await getPgPool().query<{ id: string; name: string; game: string; season_number: number }>(
    "select id,name,game,season_number from rec_leagues where id=$1", [leagueId],
  );
  const league = leagueResult.rows[0];

  const selectCols = TEAM_STAT_COLUMNS.map(([key, sql]) => `${sql} as "${key}"`).join(",\n       ");
  const result = await getPgPool().query(
    `select t.id,t.name,t.abbreviation,t.conference,t.division,
       ${selectCols}
     from rec_teams t
     left join rec_team_game_stats g on g.team_id=t.id and g.league_id=t.league_id and g.season_number=$2
     where t.league_id=$1 and coalesce(t.is_schedule_placeholder,false)=false
     group by t.id
     order by t.conference nulls last, t.division nulls last, t.name`,
    [leagueId, league.season_number],
  );

  return {
    league,
    teams: result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      abbreviation: row.abbreviation,
      conference: row.conference,
      division: row.division,
      stats: Object.fromEntries(TEAM_STAT_COLUMNS.map(([key]) => [key, Number(row[key] ?? 0)])),
    })),
  };
}

export async function getLeagueTeamStats(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  return getLeagueTeamStatsForLeagueId(context.leagueId);
}
