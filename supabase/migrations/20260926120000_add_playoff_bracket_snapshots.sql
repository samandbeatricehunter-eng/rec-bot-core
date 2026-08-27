create table if not exists public.rec_league_playoff_bracket_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  bracket jsonb not null,
  champion_team_id uuid,
  created_at timestamptz not null default now(),
  unique (league_id, season_number)
);
alter table public.rec_league_playoff_bracket_snapshots enable row level security;
