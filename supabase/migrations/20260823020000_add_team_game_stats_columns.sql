-- Add missing columns to rec_team_game_stats that the companion adapter expects.

alter table public.rec_team_game_stats
  add column if not exists time_of_possession text;

alter table public.rec_team_game_stats
  add column if not exists source_type text;

alter table public.rec_team_game_stats
  add column if not exists source_external_id text;

alter table public.rec_team_game_stats
  add column if not exists source_companion_record_id text;

alter table public.rec_team_game_stats
  add column if not exists raw_payload jsonb;

-- Unique index for the companion adapter's upsert conflict target
create unique index if not exists idx_team_game_stats_companion_record
  on public.rec_team_game_stats (source_companion_record_id)
  where source_companion_record_id is not null;
