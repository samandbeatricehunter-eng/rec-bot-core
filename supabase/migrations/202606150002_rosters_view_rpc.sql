create or replace function public.rec_roster_league_conferences(p_guild_id text)
returns jsonb
language sql
stable
as $$
  with league as (
    select l.id
    from public.rec_discord_servers s
    join public.rec_server_league_links sl
      on sl.server_id = s.id
     and sl.is_primary = true
    join public.rec_leagues l
      on l.id = sl.league_id
    where s.guild_id = p_guild_id
    limit 1
  ),
  linked_coaches as (
    select distinct on (ta.team_id)
      ta.team_id,
      acc.discord_id,
      coalesce(u.display_name, acc.global_name, acc.username) as linked_name
    from public.rec_team_assignments ta
    join league
      on league.id = ta.league_id
    left join public.rec_users u
      on u.id = ta.user_id
    left join lateral (
      select da.discord_id, da.global_name, da.username
      from public.rec_discord_accounts da
      where da.user_id = u.id
      limit 1
    ) acc on true
    where ta.assignment_status = 'active'
      and ta.ended_at is null
    order by ta.team_id
  ),
  teams as (
    select
      upper(coalesce(t.conference, '')) as conference,
      coalesce(t.division, '') as division,
      case upper(coalesce(t.conference, ''))
        when 'NFC' then 1
        when 'AFC' then 2
        else 3
      end as conference_order,
      case coalesce(t.division, '')
        when 'East' then 1
        when 'North' then 2
        when 'South' then 3
        when 'West' then 4
        else 5
      end as division_order,
      jsonb_build_object(
        'id', t.id,
        'name', case
          when t.is_relocated and t.display_city is not null
            then trim(t.display_city || ' ' || coalesce(t.display_nick, ''))
          else t.name
        end,
        'abbreviation', case
          when t.is_relocated and t.display_abbr is not null then t.display_abbr
          else t.abbreviation
        end,
        'division', coalesce(t.division, ''),
        'linkedDiscordId', lc.discord_id,
        'linkedName', lc.linked_name
      ) as team_payload,
      case
        when t.is_relocated and t.display_city is not null
          then trim(t.display_city || ' ' || coalesce(t.display_nick, ''))
        else t.name
      end as team_name
    from public.rec_teams t
    join league
      on league.id = t.league_id
    left join linked_coaches lc
      on lc.team_id = t.id
  ),
  divisions as (
    select
      conference,
      division,
      conference_order,
      division_order,
      jsonb_build_object(
        'division', division,
        'label', trim(conference || ' ' || division),
        'teams', jsonb_agg(team_payload order by team_name)
      ) as division_payload
    from teams
    group by conference, division, conference_order, division_order
  ),
  conferences as (
    select
      conference,
      conference_order,
      jsonb_build_object(
        'conference', conference,
        'divisions', jsonb_agg(division_payload order by division_order, division)
      ) as conference_payload
    from divisions
    group by conference, conference_order
  )
  select jsonb_build_object(
    'conferences',
    coalesce(jsonb_agg(conference_payload order by conference_order, conference), '[]'::jsonb)
  )
  from conferences;
$$;

create or replace function public.rec_roster_team(p_guild_id text, p_team_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_league_id uuid;
  v_team record;
  v_season integer;
  v_payload jsonb;
begin
  select l.id
    into v_league_id
  from public.rec_discord_servers s
  join public.rec_server_league_links sl
    on sl.server_id = s.id
   and sl.is_primary = true
  join public.rec_leagues l
    on l.id = sl.league_id
  where s.guild_id = p_guild_id
  limit 1;

  if v_league_id is null then
    raise exception 'No league linked to this server.';
  end if;

  select
    t.id,
    t.league_id,
    case
      when t.is_relocated and t.display_city is not null
        then trim(t.display_city || ' ' || coalesce(t.display_nick, ''))
      else t.name
    end as name,
    upper(coalesce(t.conference, '')) as conference,
    coalesce(t.division, '') as division
    into v_team
  from public.rec_teams t
  where t.id = p_team_id
    and t.league_id = v_league_id;

  if not found then
    raise exception 'Team not found in this league.';
  end if;

  select max(rs.season_number)
    into v_season
  from public.rec_roster_snapshots rs
  where rs.league_id = v_league_id;

  with players as (
    select
      coalesce(rs.player_name, 'Unknown') as name,
      upper(coalesce(rs.position, '')) as position,
      coalesce(rs.overall_rating, 0) as ovr,
      rs.dev_trait as dev,
      rs.age,
      rs.jersey_number as jersey,
      case
        when upper(coalesce(rs.position, '')) = 'QB' then 1
        when upper(coalesce(rs.position, '')) in ('HB', 'RB', 'FB') then 2
        when upper(coalesce(rs.position, '')) = 'WR' then 3
        when upper(coalesce(rs.position, '')) = 'TE' then 4
        when upper(coalesce(rs.position, '')) in ('LT', 'LG', 'C', 'RG', 'RT', 'OL', 'T', 'G') then 5
        when upper(coalesce(rs.position, '')) in ('LEDGE', 'REDGE', 'LE', 'RE', 'DT', 'DL', 'EDGE') then 6
        when upper(coalesce(rs.position, '')) in ('MIKE', 'SAM', 'WILL', 'MLB', 'LOLB', 'ROLB', 'LB') then 7
        when upper(coalesce(rs.position, '')) in ('CB', 'FS', 'SS', 'DB', 'S') then 8
        when upper(coalesce(rs.position, '')) in ('K', 'P', 'LS') then 9
        else 10
      end as group_order,
      case
        when upper(coalesce(rs.position, '')) = 'QB' then 'Quarterbacks'
        when upper(coalesce(rs.position, '')) in ('HB', 'RB', 'FB') then 'Running Backs'
        when upper(coalesce(rs.position, '')) = 'WR' then 'Wide Receivers'
        when upper(coalesce(rs.position, '')) = 'TE' then 'Tight Ends'
        when upper(coalesce(rs.position, '')) in ('LT', 'LG', 'C', 'RG', 'RT', 'OL', 'T', 'G') then 'Offensive Line'
        when upper(coalesce(rs.position, '')) in ('LEDGE', 'REDGE', 'LE', 'RE', 'DT', 'DL', 'EDGE') then 'Defensive Line'
        when upper(coalesce(rs.position, '')) in ('MIKE', 'SAM', 'WILL', 'MLB', 'LOLB', 'ROLB', 'LB') then 'Linebackers'
        when upper(coalesce(rs.position, '')) in ('CB', 'FS', 'SS', 'DB', 'S') then 'Defensive Backs'
        when upper(coalesce(rs.position, '')) in ('K', 'P', 'LS') then 'Special Teams'
        else 'Other'
      end as group_label
    from public.rec_roster_snapshots rs
    where rs.league_id = v_league_id
      and rs.team_id = p_team_id
      and (v_season is null or rs.season_number = v_season)
      and rs.is_active is not false
  ),
  groups as (
    select
      group_order,
      group_label,
      jsonb_agg(
        jsonb_build_object(
          'name', name,
          'position', position,
          'ovr', ovr,
          'dev', dev,
          'age', age,
          'jersey', jersey
        )
        order by ovr desc, name
      ) as members,
      count(*) as player_count
    from players
    group by group_order, group_label
  )
  select jsonb_build_object(
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'conference', v_team.conference,
      'division', v_team.division
    ),
    'season', v_season,
    'totalPlayers', coalesce((select count(*) from players), 0),
    'groups', coalesce(
      jsonb_agg(
        jsonb_build_object('label', group_label, 'members', members)
        order by group_order
      ) filter (where player_count > 0),
      '[]'::jsonb
    )
  )
    into v_payload
  from groups;

  return v_payload;
end;
$$;
