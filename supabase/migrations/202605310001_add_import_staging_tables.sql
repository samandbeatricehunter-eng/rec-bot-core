create table if not exists public.rec_import_staging_games (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  season_stage text not null default 'regular_season',
  week_number integer,
  external_game_id text,
  home_team_external_id text,
  away_team_external_id text,
  home_team_name text,
  away_team_name text,
  home_score integer,
  away_score integer,
  game_status text not null default 'staged',
  played_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_job_id, external_game_id)
);

create table if not exists public.rec_import_staging_standings (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  season_stage text not null default 'regular_season',
  week_number integer,
  team_external_id text,
  team_name text,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  points_for integer not null default 0,
  points_against integer not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_job_id, team_external_id)
);

create table if not exists public.rec_import_staging_team_stats (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  season_stage text not null default 'regular_season',
  week_number integer,
  team_external_id text,
  team_name text,
  stats jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_job_id, team_external_id, week_number)
);

create table if not exists public.rec_import_staging_player_stats (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  season_stage text not null default 'regular_season',
  week_number integer,
  player_external_id text,
  player_name text,
  team_external_id text,
  team_name text,
  position text,
  stats jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_job_id, player_external_id, week_number)
);

create index if not exists rec_import_staging_games_job_idx on public.rec_import_staging_games(import_job_id);
create index if not exists rec_import_staging_games_league_week_idx on public.rec_import_staging_games(league_id, season_number, week_number);
create index if not exists rec_import_staging_standings_job_idx on public.rec_import_staging_standings(import_job_id);
create index if not exists rec_import_staging_team_stats_job_idx on public.rec_import_staging_team_stats(import_job_id);
create index if not exists rec_import_staging_player_stats_job_idx on public.rec_import_staging_player_stats(import_job_id);
