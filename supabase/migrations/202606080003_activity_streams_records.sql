create table if not exists public.rec_user_h2h_global_records (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.rec_users(id) on delete cascade,
  user_b_id uuid not null references public.rec_users(id) on delete cascade,
  user_a_wins integer not null default 0,
  user_a_losses integer not null default 0,
  user_a_ties integer not null default 0,
  user_a_point_differential integer not null default 0,
  games_played integer not null default 0,
  avg_user_a_point_differential numeric not null default 0,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a_id < user_b_id),
  unique(user_a_id, user_b_id)
);

create table if not exists public.rec_user_h2h_league_records (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_a_id uuid not null references public.rec_users(id) on delete cascade,
  user_b_id uuid not null references public.rec_users(id) on delete cascade,
  user_a_wins integer not null default 0,
  user_a_losses integer not null default 0,
  user_a_ties integer not null default 0,
  user_a_point_differential integer not null default 0,
  games_played integer not null default 0,
  avg_user_a_point_differential numeric not null default 0,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a_id < user_b_id),
  unique(league_id, user_a_id, user_b_id)
);

create table if not exists public.rec_active_check_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  discord_channel_id text,
  discord_message_id text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  opened_by_discord_id text,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rec_active_check_responses (
  id uuid primary key default gen_random_uuid(),
  active_check_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid references public.rec_users(id) on delete set null,
  discord_id text not null,
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(active_check_id, discord_id)
);

create table if not exists public.rec_active_check_misses (
  id uuid primary key default gen_random_uuid(),
  active_check_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  missed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(active_check_id, user_id)
);

create table if not exists public.rec_stream_compliance_logs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  game_id uuid references public.rec_games(id) on delete set null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  required boolean not null default false,
  complied boolean not null default false,
  requirement text,
  stream_message_id text,
  stream_channel_id text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, season_number, week_number, user_id)
);

create table if not exists public.rec_game_channel_activity_penalties (
  id uuid primary key default gen_random_uuid(),
  game_channel_id uuid references public.rec_game_channels(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  penalty_type text not null default 'no_12_hour_checkin',
  penalty_weight integer not null default 1,
  created_at timestamptz not null default now(),
  unique(game_channel_id, user_id, penalty_type)
);

alter table public.rec_game_results
  add column if not exists records_applied_at timestamptz,
  add column if not exists records_apply_key text;

create unique index if not exists rec_game_results_records_apply_key on public.rec_game_results(records_apply_key) where records_apply_key is not null;

alter table public.rec_game_of_week_polls
  add column if not exists away_user_id uuid references public.rec_users(id),
  add column if not exists home_user_id uuid references public.rec_users(id),
  add column if not exists vote_deadline_display jsonb not null default '{}'::jsonb;
