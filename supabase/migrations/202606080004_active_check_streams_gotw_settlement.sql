alter table public.rec_server_routes
  add column if not exists commissioner_office_channel_id text,
  add column if not exists streams_channel_id text;

create table if not exists public.rec_active_check_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  discord_channel_id text,
  discord_message_id text,
  created_by_discord_id text,
  closes_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rec_active_check_events_open_idx on public.rec_active_check_events(league_id, status, closes_at);

create table if not exists public.rec_active_check_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  discord_id text not null,
  team_id uuid references public.rec_teams(id),
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, user_id)
);

create table if not exists public.rec_active_check_misses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id),
  missed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(event_id, user_id)
);

create table if not exists public.rec_stream_compliance_logs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  user_id uuid references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id),
  discord_channel_id text,
  discord_message_id text,
  message_url text,
  posted_at timestamptz,
  required boolean not null default false,
  complied boolean,
  status text not null default 'posted' check (status in ('posted','required_complied','required_missed','not_required')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rec_stream_compliance_logs_week_idx on public.rec_stream_compliance_logs(league_id, season_number, week_number, user_id);

create table if not exists public.rec_game_channel_activity_penalties (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  game_channel_id uuid references public.rec_game_channels(id) on delete cascade,
  game_id uuid references public.rec_games(id) on delete set null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  penalty_type text not null default 'no_12_hour_checkin',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rec_game_channel_activity_penalties_user_idx on public.rec_game_channel_activity_penalties(user_id, league_id, season_number, week_number);
