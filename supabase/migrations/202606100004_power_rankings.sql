create table public.rec_power_rankings (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  team_id uuid references public.rec_teams(id) on delete set null,
  user_id uuid,
  rank integer not null,
  previous_rank integer,
  rank_change integer,
  score numeric(8,4) not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  games_played integer not null default 0,
  point_differential numeric(8,1) not null default 0,
  win_pct numeric(5,4) not null default 0,
  avg_pd_per_game numeric(6,2) not null default 0,
  sos_score numeric(5,4) not null default 0,
  recent_form_score numeric(5,4) not null default 0,
  team_ovr_score numeric(5,4) not null default 0,
  offense_ovr numeric(5,2) default null,
  defense_ovr numeric(5,2) default null,
  stat_leader_player_name text,
  stat_leader_position text,
  stat_leader_stat_line text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_power_rankings_unique unique(league_id, season_number, week_number, team_id)
);

alter table public.rec_power_rankings enable row level security;

create index idx_power_rankings_league_week
  on public.rec_power_rankings(league_id, season_number, week_number);
create index idx_power_rankings_team
  on public.rec_power_rankings(team_id, season_number, week_number);
