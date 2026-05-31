alter table public.rec_import_jobs
  add column if not exists endpoint_selection_mode text not null default 'all';

alter table public.rec_import_jobs
  drop constraint if exists rec_import_jobs_endpoint_selection_mode_check;

alter table public.rec_import_jobs
  add constraint rec_import_jobs_endpoint_selection_mode_check
  check (endpoint_selection_mode in ('all', 'selected'));

alter table public.rec_import_endpoint_catalog
  add column if not exists user_description text,
  add column if not exists imports_data jsonb not null default '[]'::jsonb;

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports basic franchise identity and league metadata used to confirm the selected EA franchise.',
  imports_data = '["EA league ID", "league name", "season metadata", "franchise metadata"]'::jsonb
where endpoint_key = 'league_metadata';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports team identities and team records needed to map EA teams to REC teams.',
  imports_data = '["team IDs", "team names", "abbreviations", "conferences", "divisions", "team ownership mapping support"]'::jsonb
where endpoint_key = 'teams';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports current standings records for the selected week or range.',
  imports_data = '["wins", "losses", "ties", "points for", "points against", "rank/order data when available"]'::jsonb
where endpoint_key = 'standings';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports game schedule and matchup results for the selected week or range.',
  imports_data = '["matchups", "home team", "away team", "week", "game status", "final scores when available"]'::jsonb
where endpoint_key = 'schedule';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports team roster membership snapshots from the selected franchise.',
  imports_data = '["team rosters", "player-team assignments", "jersey/position metadata when available"]'::jsonb
where endpoint_key = 'rosters';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports individual player profile records from the selected franchise.',
  imports_data = '["player IDs", "player names", "positions", "ratings/attributes when available", "team assignment support"]'::jsonb
where endpoint_key = 'players';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports individual player statistical production for the selected week or range.',
  imports_data = '["passing stats", "rushing stats", "receiving stats", "defensive stats when available", "kicking stats when available"]'::jsonb
where endpoint_key = 'player_stats';

update public.rec_import_endpoint_catalog
set
  user_description = 'Imports team-level statistical production for the selected week or range.',
  imports_data = '["team passing yards", "team rushing yards", "points scored", "points allowed", "turnovers and other available team totals"]'::jsonb
where endpoint_key = 'team_stats';

comment on column public.rec_import_jobs.endpoint_selection_mode is 'Endpoint setting for week imports: all or selected. This is not an import scope.';
comment on column public.rec_import_endpoint_catalog.user_description is 'Plain-language explanation shown before commissioners run selected endpoint imports.';
comment on column public.rec_import_endpoint_catalog.imports_data is 'User-facing bullet list of data imported by this endpoint.';
