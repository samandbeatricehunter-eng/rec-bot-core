import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export async function getLeagueStats(input: { guildId: string; teamId?: string | null; position?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueResult = await getPgPool().query<{ id: string; name: string; game: string; season_number: number }>(
    "select id,name,game,season_number from rec_leagues where id=$1", [context.leagueId],
  );
  const league = leagueResult.rows[0];
  const teamsResult = await getPgPool().query<{ id: string; name: string; abbreviation: string | null }>(
    "select id,name,abbreviation from rec_teams where league_id=$1 and coalesce(is_schedule_placeholder,false)=false order by name", [context.leagueId],
  );
  const params: unknown[] = [context.leagueId, league.season_number];
  let filter = "";
  if (input.teamId) { params.push(input.teamId); filter += ` and p.team_id=$${params.length}`; }
  if (input.position) { params.push(input.position); filter += ` and upper(p.position)=upper($${params.length})`; }

  const playersResult = await getPgPool().query(
    `with numeric_stats as (
       select s.player_id,e.key,sum(e.value::numeric) as total
       from rec_player_weekly_stats s cross join lateral jsonb_each_text(s.stats) e
       where s.league_id=$1 and s.season_number=$2 and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
       group by s.player_id,e.key
     ), totals as (
       select player_id,jsonb_object_agg(key,total order by key) as stats from numeric_stats group by player_id
     )
     select p.id,p.full_name as "fullName",p.position,p.jersey_number as "jerseyNumber",
            p.team_id as "teamId",t.name as "teamName",t.abbreviation as "teamAbbreviation",coalesce(x.stats,'{}'::jsonb) as stats
       from rec_players p left join rec_teams t on t.id=p.team_id left join totals x on x.player_id=p.id
      where p.league_id=$1 and coalesce(p.roster_status,'active')='active' ${filter}
      order by t.name nulls last,p.position,p.full_name limit 500`,
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
    [context.leagueId, league.season_number],
  );
  return {
    league,
    teams: teamsResult.rows,
    positions: [...new Set(playersResult.rows.map((row: any) => row.position).filter(Boolean))].sort(),
    players: playersResult.rows,
    leaders: Object.fromEntries(leadersResult.rows.map((row: any) => [row.key, row.leaders])),
  };
}
