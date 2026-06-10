-- Add points_for and points_against to all user record tables so that per-game
-- scoring totals accumulate alongside wins/losses/point_differential.
-- Also ensures close_games_within_7 and blowout_* counters exist (they were
-- already present on some tables but weren't being written; this is a no-op
-- add-if-not-exists to make all three tables consistent).

alter table public.rec_season_user_records
  add column if not exists points_for    integer not null default 0,
  add column if not exists points_against integer not null default 0;

alter table public.rec_league_user_records
  add column if not exists points_for    integer not null default 0,
  add column if not exists points_against integer not null default 0;

alter table public.rec_global_user_records
  add column if not exists points_for    integer not null default 0,
  add column if not exists points_against integer not null default 0;

alter table public.rec_season_user_records  enable row level security;
alter table public.rec_league_user_records  enable row level security;
alter table public.rec_global_user_records  enable row level security;
