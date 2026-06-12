create table public.rec_active_check_events (
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

create table public.rec_active_check_responses (
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

create table public.rec_active_check_misses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rec_active_check_events(id) on delete cascade,
  league_id uuid not null,
  user_id uuid not null,
  team_id uuid,
  missed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.rec_active_check_misses enable row level security;
