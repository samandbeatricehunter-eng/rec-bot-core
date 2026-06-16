insert into public.rec_import_endpoint_catalog (
  endpoint_key,
  endpoint_label,
  endpoint_group,
  enabled,
  admin_only,
  experimental,
  default_selected,
  sort_order,
  notes,
  updated_at
)
values (
  'weekly_stats',
  'Weekly Stats',
  'core',
  true,
  false,
  false,
  true,
  40,
  'Single weekly EA stats bundle used to stage games, team stats, and player stats without duplicate fetches.',
  now()
)
on conflict (endpoint_key) do update set
  endpoint_label = excluded.endpoint_label,
  endpoint_group = excluded.endpoint_group,
  enabled = excluded.enabled,
  admin_only = excluded.admin_only,
  experimental = excluded.experimental,
  default_selected = excluded.default_selected,
  sort_order = excluded.sort_order,
  notes = excluded.notes,
  updated_at = excluded.updated_at;

update public.rec_import_endpoint_catalog
set
  endpoint_group = 'disabled',
  enabled = false,
  admin_only = false,
  experimental = false,
  default_selected = false,
  updated_at = now()
where endpoint_key in ('players', 'schedule', 'player_stats', 'team_stats', 'transactions');

update public.rec_import_endpoint_catalog
set
  endpoint_group = 'core',
  enabled = true,
  admin_only = false,
  experimental = false,
  default_selected = true,
  updated_at = now()
where endpoint_key in ('league_metadata', 'teams', 'standings', 'rosters');
