create table if not exists public.rec_import_endpoint_catalog (
  endpoint_key text primary key,
  endpoint_label text not null,
  endpoint_group text not null default 'core',
  enabled boolean not null default true,
  admin_only boolean not null default false,
  experimental boolean not null default false,
  default_selected boolean not null default false,
  sort_order integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.rec_import_endpoint_catalog (
  endpoint_key,
  endpoint_label,
  endpoint_group,
  enabled,
  admin_only,
  experimental,
  default_selected,
  sort_order,
  notes
) values
  ('league_metadata', 'League Metadata', 'core', true, false, false, true, 10, 'Core franchise metadata used to identify the selected EA league.'),
  ('teams', 'Teams', 'core', true, false, false, true, 20, 'Team identity and franchise mapping data.'),
  ('standings', 'Standings', 'core', true, false, false, true, 30, 'Imported standings when reliable; REC can still recalculate standings from games.'),
  ('schedule', 'Schedule', 'core', true, false, false, true, 40, 'Schedule and matchup data. Used by full regular season schedule import.'),
  ('rosters', 'Rosters', 'core', true, false, false, true, 50, 'Roster and player/team ownership snapshots.'),
  ('players', 'Players', 'core', true, false, false, true, 60, 'Player identity and ratings payloads.'),
  ('player_stats', 'Player Stats', 'core', true, false, false, true, 70, 'Weekly or season player stat payloads.'),
  ('team_stats', 'Team Stats', 'core', true, false, false, true, 80, 'Weekly or season team stat payloads.'),
  ('kick_returns', 'Kick Returns', 'disabled', false, true, true, false, 200, 'Not wired for normal imports. May be reviewed later from admin-only tools.'),
  ('punt_returns', 'Punt Returns', 'disabled', false, true, true, false, 210, 'Not wired for normal imports. May be reviewed later from admin-only tools.'),
  ('awards', 'Awards', 'disabled', false, true, true, false, 220, 'Not wired for normal imports. Awards should not drive payouts directly.'),
  ('news', 'News', 'disabled', false, true, true, false, 230, 'Not wired for normal imports.'),
  ('draft_picks', 'Draft Picks', 'disabled', false, true, true, false, 240, 'Not wired for normal imports yet.'),
  ('injuries', 'Injuries', 'disabled', false, true, true, false, 250, 'Not wired for normal imports yet.'),
  ('depth_charts', 'Depth Charts', 'disabled', false, true, true, false, 260, 'Not wired for normal imports yet.'),
  ('transactions', 'Transactions', 'disabled', false, true, true, false, 270, 'Not wired for normal imports yet.')
on conflict (endpoint_key) do update set
  endpoint_label = excluded.endpoint_label,
  endpoint_group = excluded.endpoint_group,
  enabled = excluded.enabled,
  admin_only = excluded.admin_only,
  experimental = excluded.experimental,
  default_selected = excluded.default_selected,
  sort_order = excluded.sort_order,
  notes = excluded.notes,
  updated_at = now();

create index if not exists rec_import_endpoint_catalog_enabled_idx
  on public.rec_import_endpoint_catalog(enabled, admin_only, sort_order);
