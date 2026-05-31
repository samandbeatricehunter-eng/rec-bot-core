alter table public.rec_import_staging_games
  add column if not exists result_resolution_status text not null default 'unresolved',
  add column if not exists result_resolution_source text,
  add column if not exists manually_resolved_by_discord_id text,
  add column if not exists manually_resolved_at timestamptz,
  add column if not exists reimport_requested_at timestamptz,
  add column if not exists reimport_requested_by_discord_id text,
  add column if not exists resolution_notes text;

alter table public.rec_import_staging_games
  drop constraint if exists rec_import_staging_games_result_resolution_status_check;

alter table public.rec_import_staging_games
  add constraint rec_import_staging_games_result_resolution_status_check
  check (result_resolution_status in ('unresolved', 'reimport_requested', 'manual_entry', 'resolved', 'ignored'));

alter table public.rec_import_staging_games
  drop constraint if exists rec_import_staging_games_result_resolution_source_check;

alter table public.rec_import_staging_games
  add constraint rec_import_staging_games_result_resolution_source_check
  check (result_resolution_source is null or result_resolution_source in ('ea_reimport', 'manual_admin_entry', 'ignored'));

comment on column public.rec_import_staging_games.result_resolution_status is 'Tracks missing score/result recovery for staged imported games.';
comment on column public.rec_import_staging_games.result_resolution_source is 'How a missing game result was resolved: EA reimport, manual admin entry, or ignored.';
