create table if not exists public.rec_active_check_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer,
  week_number integer,
  status text not null default 'open',
  discord_channel_id text,
  discord_message_id text,
  created_by_discord_id text,
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_active_check_events enable row level security;

alter table public.rec_active_check_events
  add column if not exists season_number integer,
  add column if not exists week_number integer,
  add column if not exists status text not null default 'open',
  add column if not exists discord_channel_id text,
  add column if not exists discord_message_id text,
  add column if not exists created_by_discord_id text,
  add column if not exists closes_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.rec_active_check_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null,
  user_id uuid not null,
  discord_id text,
  team_id uuid,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
alter table public.rec_active_check_responses enable row level security;

alter table public.rec_active_check_responses
  add column if not exists event_id uuid references public.rec_active_check_events(id) on delete cascade,
  add column if not exists league_id uuid,
  add column if not exists user_id uuid,
  add column if not exists discord_id text,
  add column if not exists team_id uuid,
  add column if not exists responded_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.rec_active_check_misses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null,
  user_id uuid not null,
  team_id uuid,
  missed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.rec_active_check_misses enable row level security;

alter table public.rec_active_check_misses
  add column if not exists event_id uuid references public.rec_active_check_events(id) on delete cascade,
  add column if not exists league_id uuid,
  add column if not exists user_id uuid,
  add column if not exists team_id uuid,
  add column if not exists missed_at timestamptz,
  add column if not exists created_at timestamptz not null default now();
