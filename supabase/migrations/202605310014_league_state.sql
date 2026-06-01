create table if not exists public.rec_league_state (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  season_number integer not null default 1,
  season_stage text not null default 'regular_season',
  current_week integer not null default 1,
  next_advance_at timestamptz,
  next_advance_timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id)
);
