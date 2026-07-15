alter table public.rec_teams
  add column if not exists is_schedule_placeholder boolean not null default false;

update public.rec_teams
set
  name = 'FCS TEAM',
  abbreviation = 'FCS',
  conference = 'Independents',
  division = 'Teams',
  display_city = 'FCS',
  display_nick = 'TEAM',
  is_schedule_placeholder = true,
  updated_at = now()
where (upper(coalesce(abbreviation, '')) = 'FCS' or upper(coalesce(name, '')) in ('FCS', 'FCS TEAM'))
  and league_id in (select id from public.rec_leagues where game = 'cfb_27');

insert into public.rec_teams (
  league_id,
  name,
  abbreviation,
  conference,
  division,
  display_city,
  display_nick,
  source,
  is_schedule_placeholder,
  created_at,
  updated_at
)
select
  l.id,
  'FCS TEAM',
  'FCS',
  'Independents',
  'Teams',
  'FCS',
  'TEAM',
  'manual_admin_entry',
  true,
  now(),
  now()
from public.rec_leagues l
where l.game = 'cfb_27'
  and not exists (
    select 1
    from public.rec_teams t
    where t.league_id = l.id
      and (upper(coalesce(t.abbreviation, '')) = 'FCS' or upper(coalesce(t.name, '')) in ('FCS', 'FCS TEAM'))
  );

drop index if exists public.rec_games_one_away_team_per_week_key;
drop index if exists public.rec_games_one_home_team_per_week_key;

create index if not exists rec_games_away_team_week_idx
  on public.rec_games (league_id, season_id, week_number, away_team_id)
  where away_team_id is not null;

create index if not exists rec_games_home_team_week_idx
  on public.rec_games (league_id, season_id, week_number, home_team_id)
  where home_team_id is not null;
