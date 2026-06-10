-- Ensure rec_season_user_records has the season_number and avg_point_differential
-- columns that applyAdvanceRecords writes. The table was created before these
-- columns were added to the advance service, so it may be missing them.
-- ADD COLUMN IF NOT EXISTS is safe to run against a table that already has the column.

alter table public.rec_season_user_records
  add column if not exists season_number integer,
  add column if not exists avg_point_differential numeric default 0,
  add column if not exists games_played integer default 0,
  add column if not exists wins integer default 0,
  add column if not exists losses integer default 0,
  add column if not exists ties integer default 0,
  add column if not exists point_differential numeric default 0,
  add column if not exists updated_at timestamptz default now();

alter table public.rec_season_user_records enable row level security;
