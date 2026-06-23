-- Expose original_abbreviation in team payloads so the edit-team flow can always
-- pass the NFL abbreviation to createCustomTeamReplacement, even when a team has
-- already been relocated and its display abbreviation differs from the original.
create or replace function public.rec_roster_league_conferences(p_guild_id text)
returns jsonb
language sql
stable
as $$
  with league as (
    select l.id, coalesce(l.season_number, l.display_season_number, 1) as season_number
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
      ta.user_id,
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
        'originalAbbreviation', t.original_abbreviation,
        'division', coalesce(t.division, ''),
        'display_nick', t.display_nick,
        'is_relocated', coalesce(t.is_relocated, false),
        'linkedDiscordId', lc.discord_id,
        'linkedName', lc.linked_name,
        'wins', coalesce(dr.wins, 0),
        'losses', coalesce(dr.losses, 0),
        'ties', coalesce(dr.ties, 0),
        'recordText', concat(coalesce(dr.wins, 0), '-', coalesce(dr.losses, 0), '-', coalesce(dr.ties, 0))
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
    left join public.rec_season_user_display_records dr
      on dr.league_id = league.id
     and dr.season_number = league.season_number
     and dr.user_id = lc.user_id
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
