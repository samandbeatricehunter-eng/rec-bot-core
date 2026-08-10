alter table public.rec_league_configuration
  add column if not exists slider_preset_id text,
  add column if not exists slider_catalog_version text,
  add column if not exists slider_settings jsonb not null default '{}'::jsonb;

comment on column public.rec_league_configuration.slider_preset_id is
  'Optional creator-attributed community preset selected by the commissioner.';
comment on column public.rec_league_configuration.slider_catalog_version is
  'Version of the game-specific slider catalog used to validate the saved values.';
comment on column public.rec_league_configuration.slider_settings is
  'Authoritative resolved slider values. Client values are filtered against the game catalog.';
