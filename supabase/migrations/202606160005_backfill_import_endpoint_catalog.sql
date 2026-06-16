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
  ('news', 'News', 'core', true, false, true, true, 90, 'Imports and logs EA league news feed payloads.'),
  ('transactions', 'Transactions', 'core', true, false, true, true, 100, 'Imports and logs EA transaction feed payloads when available.'),
  ('injuries', 'Injuries', 'core', true, false, true, true, 110, 'Imports and logs EA injury feed payloads when available.')
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

alter table public.rec_import_endpoint_catalog enable row level security;
