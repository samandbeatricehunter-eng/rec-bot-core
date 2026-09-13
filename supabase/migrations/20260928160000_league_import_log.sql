-- Persisted EA import history, one row per successful dataset write. Backs the League Mgmt
-- "League Health" tile (% of this season's weeks with a clean data import, per-week gaps by
-- dataset) -- previously there was no durable import history at all, only an in-memory
-- last-run cache (madden-ea/ea-connections.service.ts's importProgressStore). week_number is
-- null for league-wide snapshot datasets (teams/standings/rosters/free_agents), which aren't
-- per-week -- see WEEKLY_DATASETS in ea-datasets.ts.
create table if not exists public.rec_import_log (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer,
  dataset text not null,
  imported_at timestamptz not null default now()
);
alter table public.rec_import_log enable row level security;
create index if not exists rec_import_log_league_season_idx on public.rec_import_log(league_id, season_number, week_number);
