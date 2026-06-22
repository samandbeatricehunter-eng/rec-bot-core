-- Aggregated season box-score stats for CPU-controlled teams (no linked user).
-- Rebuilt on box score approval; wiped when the league season number rolls over.

create table if not exists public.rec_cpu_team_season_stats (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  games_logged integer not null default 0,
  box_scores_logged integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  total_yards bigint not null default 0,
  passing_yards bigint not null default 0,
  rushing_yards bigint not null default 0,
  first_downs bigint not null default 0,
  turnovers_generated bigint not null default 0,
  turnovers_committed bigint not null default 0,
  turnover_differential bigint not null default 0,
  red_zone_off_pct_avg integer not null default 0,
  red_zone_def_pct_avg integer not null default 0,
  active_streak text not null default '—',
  updated_at timestamptz not null default now()
);

create unique index if not exists rec_cpu_team_season_stats_unique
  on public.rec_cpu_team_season_stats (league_id, season_number, team_id);

create index if not exists idx_rec_cpu_team_season_stats_league_season
  on public.rec_cpu_team_season_stats (league_id, season_number);

alter table public.rec_cpu_team_season_stats enable row level security;
