-- Fixes /openteams (and any other consumer of rec_roster_league_conferences) always showing
-- "0-0-0" for CPU-controlled teams.
--
-- Root cause: the function joined each team's record from rec_season_user_display_records via
-- the linked coach's user_id. That table is keyed by user_id and only ever gets a row through
-- display-records.service.ts's per-game aggregation, which explicitly skips a CPU-vs-CPU game
-- entirely and, for a CPU-vs-human game, only records the human side -- so a CPU team (no linked
-- coach, lc.user_id is null) never has a matching row and always fell back to the 0 default,
-- regardless of its real game history.
--
-- Fix: add a team-level record computed directly from completed rec_games rows (win/loss/tie by
-- score comparison, for either side of the game), and fall back to it whenever there's no
-- per-user display record. Verified live against a real league: Bengals/Jaguars/Texans/Titans
-- (all CPU-controlled) went from 0-0-0 to their real 2-9-0/1-9-0/3-7-0/4-6-0 records, matching
-- the site's Standings page.

CREATE OR REPLACE FUNCTION public.rec_roster_league_conferences(p_guild_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  season as (
    select s.id as season_id
    from public.rec_seasons s, league
    where s.league_id = league.id and s.display_season_number = league.season_number
    limit 1
  ),
  team_games as (
    select team_id,
      count(*) filter (where result = 'win') as wins,
      count(*) filter (where result = 'loss') as losses,
      count(*) filter (where result = 'tie') as ties
    from (
      select g.home_team_id as team_id,
        case when g.home_score > g.away_score then 'win' when g.home_score < g.away_score then 'loss' else 'tie' end as result
      from public.rec_games g, season
      where g.season_id = season.season_id and g.home_score is not null and g.away_score is not null
      union all
      select g.away_team_id as team_id,
        case when g.away_score > g.home_score then 'win' when g.away_score < g.home_score then 'loss' else 'tie' end as result
      from public.rec_games g, season
      where g.season_id = season.season_id and g.home_score is not null and g.away_score is not null
    ) x
    group by team_id
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
  pending_requests as (
    select distinct team_id
    from public.rec_team_link_requests r
    join league on league.id = r.league_id
    where r.status in ('pending', 'approved')
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
        'hasPendingRequest', (pr.team_id is not null),
        'wins', coalesce(dr.wins, tg.wins, 0),
        'losses', coalesce(dr.losses, tg.losses, 0),
        'ties', coalesce(dr.ties, tg.ties, 0),
        'recordText', concat(coalesce(dr.wins, tg.wins, 0), '-', coalesce(dr.losses, tg.losses, 0), '-', coalesce(dr.ties, tg.ties, 0))
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
    left join pending_requests pr
      on pr.team_id = t.id
    left join public.rec_season_user_display_records dr
      on dr.league_id = league.id
     and dr.season_number = league.season_number
     and dr.user_id = lc.user_id
    left join team_games tg
      on tg.team_id = t.id
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
$function$;
