-- Madden Companion ingestion: league-owned URLs, immutable replay protection, and
-- league/season-scoped normalized storage. The URL token is the authority for the REC
-- league; payload-supplied league names/ids are metadata and can never redirect writes.

alter table public.rec_import_connections
  add column if not exists endpoint_slug text,
  add column if not exists token_hash text,
  add column if not exists external_league_id text,
  add column if not exists token_rotated_at timestamptz;

update public.rec_import_connections
set endpoint_slug = replace(id::text, '-', '')
where connection_type = 'madden_companion' and endpoint_slug is null;

update public.rec_import_connections
set token_hash = config->>'token_hash'
where connection_type = 'madden_companion' and token_hash is null;

-- One active Companion destination per REC league. Older connections are retained for audit,
-- but disabled so they cannot keep writing after a replacement URL is generated.
with ranked as (
  select id, row_number() over (partition by league_id order by created_at desc, id desc) as rn
  from public.rec_import_connections
  where connection_type = 'madden_companion' and status = 'active'
)
update public.rec_import_connections c
set status = 'disabled', updated_at = now()
from ranked r
where c.id = r.id and r.rn > 1;

create unique index if not exists rec_import_connections_companion_slug_key
  on public.rec_import_connections(endpoint_slug)
  where connection_type = 'madden_companion';
create unique index if not exists rec_import_connections_companion_token_key
  on public.rec_import_connections(token_hash)
  where connection_type = 'madden_companion' and token_hash is not null;
create unique index if not exists rec_import_connections_one_active_companion_per_league
  on public.rec_import_connections(league_id)
  where connection_type = 'madden_companion' and status = 'active';

alter table public.rec_import_jobs
  add column if not exists source_checksum text,
  add column if not exists external_season_key text,
  add column if not exists record_count integer not null default 0,
  add column if not exists duplicate_of_job_id uuid references public.rec_import_jobs(id) on delete set null;

create unique index if not exists rec_import_jobs_companion_replay_key
  on public.rec_import_jobs(league_id, connection_id, task_key, source_checksum)
  where source_type = 'madden_companion' and source_checksum is not null and duplicate_of_job_id is null;

alter table public.rec_import_payloads add column if not exists checksum text;
create index if not exists rec_import_payloads_checksum_idx on public.rec_import_payloads(checksum);

-- Latest normalized view of every entity received from Madden. Raw payloads remain immutable
-- in rec_import_payloads; this table is an idempotent materialization for league features.
create table if not exists public.rec_madden_companion_records (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  connection_id uuid not null references public.rec_import_connections(id) on delete cascade,
  external_league_id text,
  external_season_key text not null,
  endpoint_key text not null check (endpoint_key in (
    'league_metadata','teams','standings','schedule','rosters','player_stats','team_stats'
  )),
  record_key text not null,
  source_team_id text,
  source_player_id text,
  source_game_id text,
  week_number integer,
  stat_category text,
  normalized_data jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  first_import_job_id uuid not null references public.rec_import_jobs(id) on delete restrict,
  last_import_job_id uuid not null references public.rec_import_jobs(id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, external_season_key, endpoint_key, record_key)
);
alter table public.rec_madden_companion_records enable row level security;
create index if not exists rec_madden_companion_records_league_endpoint_idx
  on public.rec_madden_companion_records(league_id, external_season_key, endpoint_key);
create index if not exists rec_madden_companion_records_player_idx
  on public.rec_madden_companion_records(league_id, external_season_key, source_player_id)
  where source_player_id is not null;
create index if not exists rec_madden_companion_records_game_idx
  on public.rec_madden_companion_records(league_id, external_season_key, source_game_id)
  where source_game_id is not null;

-- Append-only record changes make corrections and Madden-side mutations auditable without
-- creating duplicate active stat rows.
create table if not exists public.rec_madden_companion_record_versions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.rec_madden_companion_records(id) on delete cascade,
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  content_checksum text not null,
  normalized_data jsonb not null,
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (record_id, content_checksum)
);
alter table public.rec_madden_companion_record_versions enable row level security;
create index if not exists rec_madden_companion_record_versions_job_idx
  on public.rec_madden_companion_record_versions(import_job_id);

revoke all on table public.rec_madden_companion_records from anon, authenticated;
revoke all on table public.rec_madden_companion_record_versions from anon, authenticated;
grant all on table public.rec_madden_companion_records to service_role;
grant all on table public.rec_madden_companion_record_versions to service_role;

