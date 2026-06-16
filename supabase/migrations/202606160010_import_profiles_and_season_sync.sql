alter table public.rec_import_jobs
  add column if not exists import_profile text;

create table if not exists public.rec_season_sync_state (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  full_schedule_imported_at timestamptz,
  full_schedule_import_job_id uuid references public.rec_import_jobs(id) on delete set null,
  last_roster_sync_at timestamptz,
  last_roster_sync_import_job_id uuid references public.rec_import_jobs(id) on delete set null,
  last_weekly_import_week integer,
  last_weekly_import_at timestamptz,
  last_weekly_import_job_id uuid references public.rec_import_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number)
);

alter table public.rec_import_jobs enable row level security;
alter table public.rec_season_sync_state enable row level security;

create index if not exists idx_rec_season_sync_state_league_season
  on public.rec_season_sync_state (league_id, season_number);
