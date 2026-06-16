create table if not exists public.rec_import_staging_league_feed (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  guild_id text,
  ea_league_id bigint,
  season_number integer,
  season_index integer,
  season_stage text,
  week_number integer,
  endpoint_key text not null,
  event_type text not null,
  event_category text,
  external_event_id text,
  title text,
  body text,
  player_external_id text,
  player_name text,
  team_external_id text,
  team_name text,
  from_team_external_id text,
  from_team_name text,
  to_team_external_id text,
  to_team_name text,
  occurred_at timestamptz,
  source_hash text not null,
  normalized jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_job_id, endpoint_key, source_hash)
);

alter table public.rec_import_staging_league_feed enable row level security;

create index if not exists rec_import_staging_league_feed_job_idx
  on public.rec_import_staging_league_feed(import_job_id, endpoint_key, event_type);

create table if not exists public.rec_league_event_logs (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  import_job_id uuid references public.rec_import_jobs(id) on delete set null,
  season_number integer,
  season_index integer,
  season_stage text,
  week_number integer,
  source text not null default 'ea_import',
  source_endpoint text,
  event_type text not null,
  event_category text,
  external_event_id text,
  event_hash text not null,
  title text not null,
  body text,
  player_id uuid references public.rec_players(id) on delete set null,
  player_external_id text,
  player_name text,
  team_id uuid references public.rec_teams(id) on delete set null,
  team_external_id text,
  team_name text,
  from_team_id uuid references public.rec_teams(id) on delete set null,
  from_team_external_id text,
  from_team_name text,
  to_team_id uuid references public.rec_teams(id) on delete set null,
  to_team_external_id text,
  to_team_name text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  posted_at timestamptz,
  posted_channel_id text,
  posted_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, event_hash)
);

alter table public.rec_league_event_logs enable row level security;

create index if not exists rec_league_event_logs_guild_type_idx
  on public.rec_league_event_logs(guild_id, event_type, created_at desc);

create index if not exists rec_league_event_logs_league_week_idx
  on public.rec_league_event_logs(league_id, season_number, week_number, event_type);

create index if not exists rec_league_event_logs_unposted_idx
  on public.rec_league_event_logs(guild_id, event_type, created_at desc)
  where posted_at is null;

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

alter table public.rec_import_endpoint_catalog enable row level security;

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

update public.rec_import_endpoint_catalog
set enabled = true,
    admin_only = false,
    experimental = true,
    default_selected = true,
    endpoint_group = 'core',
    notes = 'Imports and logs EA league news feed payloads.',
    updated_at = now()
where endpoint_key = 'news';

update public.rec_import_endpoint_catalog
set enabled = true,
    admin_only = false,
    experimental = true,
    default_selected = true,
    endpoint_group = 'core',
    notes = 'Imports and logs EA transaction feed payloads when available.',
    updated_at = now()
where endpoint_key = 'transactions';

update public.rec_import_endpoint_catalog
set enabled = true,
    admin_only = false,
    experimental = true,
    default_selected = true,
    endpoint_group = 'core',
    notes = 'Imports and logs EA injury feed payloads when available.',
    updated_at = now()
where endpoint_key = 'injuries';
