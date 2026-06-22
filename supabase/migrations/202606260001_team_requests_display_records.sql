-- Team link requests (user-initiated) and display-only season records for advance-week results.

create table if not exists public.rec_team_link_requests (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  requester_user_id uuid not null references public.rec_users(id) on delete cascade,
  requester_discord_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  authority text check (authority in ('member', 'co_commissioner', 'commissioner')),
  assigned_by_user_id uuid references public.rec_users(id) on delete set null,
  assigned_by_discord_id text,
  review_channel_id text,
  review_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_rec_team_link_requests_league_status
  on public.rec_team_link_requests (league_id, status, created_at desc);

create unique index if not exists idx_rec_team_link_requests_pending_team
  on public.rec_team_link_requests (league_id, team_id)
  where status in ('pending', 'approved');

alter table public.rec_team_link_requests enable row level security;

create table if not exists public.rec_season_user_display_records (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  points_for integer not null default 0,
  points_against integer not null default 0,
  point_differential integer not null default 0,
  games_played integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, user_id)
);

alter table public.rec_season_user_display_records enable row level security;

create index if not exists idx_rec_season_user_display_records_league_season
  on public.rec_season_user_display_records (league_id, season_number);

-- Teams embed: show display W-L-T on linked coaches.
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
        'division', coalesce(t.division, ''),
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
