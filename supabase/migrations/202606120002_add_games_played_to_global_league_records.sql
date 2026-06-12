-- rec_global_user_records and rec_league_user_records were missing games_played,
-- which applyAdvanceRecords always writes in its patch. The write threw "column does
-- not exist" and was swallowed by a .catch, so global/league records silently never
-- updated (season records, which have the column, updated fine).
alter table public.rec_global_user_records add column if not exists games_played integer not null default 0;
alter table public.rec_league_user_records add column if not exists games_played integer not null default 0;

-- RLS already enabled on both tables (2026-06-09 backfill); included here for portability.
alter table public.rec_global_user_records enable row level security;
alter table public.rec_league_user_records enable row level security;
