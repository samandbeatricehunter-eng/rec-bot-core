create table if not exists public.rec_team_byes (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id),
  season_number integer not null,
  team_id uuid not null references public.rec_teams(id),
  week_number integer not null,
  created_at timestamptz not null default now(),
  unique (league_id, season_number, team_id, week_number)
);

alter table public.rec_team_byes enable row level security;

create index if not exists rec_team_byes_lookup_idx on public.rec_team_byes (league_id, season_number, team_id);
