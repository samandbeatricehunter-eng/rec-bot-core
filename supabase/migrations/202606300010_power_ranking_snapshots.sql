-- Weekly power-ranking snapshots so the rankings view can show each team's
-- movement vs the previous week. A snapshot is written at each advance.
create table if not exists public.rec_power_ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  rank integer not null,
  score numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (league_id, season_number, week_number, team_id)
);

alter table public.rec_power_ranking_snapshots enable row level security;

create index if not exists rec_power_ranking_snapshots_lookup
  on public.rec_power_ranking_snapshots (league_id, season_number, week_number);
