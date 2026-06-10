-- Badge system tables for season-long cumulative badges and record tracking

create table if not exists public.rec_user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  season_number integer,
  badge_name text not null,
  badge_label text,
  earned_value numeric,
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Allow both global badges (no league_id) and league-specific badges
  -- Allow both seasonal and career badges via season_number field
  unique(user_id, league_id, season_number, badge_name)
);

create table if not exists public.rec_league_records (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  record_name text not null,
  record_value numeric not null,
  record_holder_id uuid references public.rec_users(id) on delete set null,
  previous_holder_id uuid references public.rec_users(id) on delete set null,
  previous_value numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  season_ended_at timestamptz,
  -- Each league tracks its own records per season
  unique(league_id, season_number, record_name)
);

-- Indexes for common queries
create index if not exists idx_rec_user_badges_user_league on public.rec_user_badges(user_id, league_id);
create index if not exists idx_rec_user_badges_season on public.rec_user_badges(season_number);
create index if not exists idx_rec_league_records_holder on public.rec_league_records(record_holder_id);
create index if not exists idx_rec_league_records_season on public.rec_league_records(league_id, season_number);

-- RLS: service role bypasses; blocks direct anon-key access
alter table public.rec_user_badges enable row level security;
alter table public.rec_league_records enable row level security;
