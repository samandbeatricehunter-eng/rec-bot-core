alter table public.rec_import_staging_games
  add column if not exists score_fix_status text not null default 'open';

alter table public.rec_import_staging_games
  add column if not exists score_fix_source text;

alter table public.rec_import_staging_games
  add column if not exists score_fixed_by_discord_id text;

alter table public.rec_import_staging_games
  add column if not exists score_fixed_at timestamptz;

alter table public.rec_import_staging_games
  add column if not exists score_reimport_requested_at timestamptz;

alter table public.rec_import_staging_games
  add column if not exists score_reimport_requested_by_discord_id text;

alter table public.rec_import_staging_games
  add column if not exists score_fix_notes text;
