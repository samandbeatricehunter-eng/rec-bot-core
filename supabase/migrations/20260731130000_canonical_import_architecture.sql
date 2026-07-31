-- Editorial & Import Master Plan, Phase 1: canonical import architecture.
--
-- Pipeline this schema supports (master plan §4.1):
--   receive source -> preserve immutable raw source -> classify -> versioned parser/adapter
--   -> normalized staging records -> schema validation -> duplicate/conflict detection
--   -> review -> approval -> canonical domain services -> domain events -> editorial facts
--
-- This migration is staging infrastructure only. No adapter writes directly to standings,
-- articles, wallets, badges, or Discord-specific tables (master plan §4.1) — canonical domain
-- services (existing box-score/schedule/roster services) remain the only writers of those
-- tables. Phase 2+ (CFB baseline roster, Madden Companion, Direct Sync) build the adapters
-- that populate these tables; none of that exists yet.

create table if not exists public.rec_import_connections (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  connection_type text not null check (connection_type in ('madden_companion','madden_direct_sync','cfb_baseline','cfb_screenshot','manual')),
  status text not null default 'active' check (status in ('active','disabled','error')),
  config jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_health_status text,
  created_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_import_connections enable row level security;
create index if not exists rec_import_connections_league_idx on public.rec_import_connections(league_id, connection_type);

create table if not exists public.rec_import_jobs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  connection_id uuid references public.rec_import_connections(id) on delete set null,
  source_type text not null check (source_type in ('cfb_screenshot','cfb_baseline','madden_companion','madden_direct_sync','manual')),
  task_key text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','superseded')),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  requested_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.rec_import_jobs enable row level security;
create index if not exists rec_import_jobs_league_idx on public.rec_import_jobs(league_id, status, created_at desc);

-- Immutable raw upload (screenshot, exported payload file) — never mutated after insert.
-- Preserving the exact bytes the pipeline started from is what makes a later re-parse or
-- reviewer dispute possible; adapters read this, they never overwrite it.
create table if not exists public.rec_import_files (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  storage_key text not null,
  original_url text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  created_at timestamptz not null default now()
);
alter table public.rec_import_files enable row level security;
create index if not exists rec_import_files_job_idx on public.rec_import_files(import_job_id);

-- Raw structured payload as received/extracted, before normalization — a Companion export
-- blob, or an OCR/vision extraction result. Also immutable; normalization reads this into
-- rec_import_records rather than editing it in place.
create table if not exists public.rec_import_payloads (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  payload jsonb not null,
  adapter_key text not null,
  adapter_version text not null,
  created_at timestamptz not null default now()
);
alter table public.rec_import_payloads enable row level security;
create index if not exists rec_import_payloads_job_idx on public.rec_import_payloads(import_job_id);

-- One normalized staging record per domain entity extracted (a game result, a team-stat
-- line, a roster player, a standing row) — the unit that goes through review/approval before
-- a canonical domain service ever sees it. entity_key is a natural dedup key (e.g.
-- "league:week:home_team:away_team") so a re-run of the same source doesn't create duplicates.
create table if not exists public.rec_import_records (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  record_type text not null,
  entity_key text not null,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','applied')),
  trust_level text not null default 'unreviewed_extraction' check (trust_level in (
    'commissioner_approved_import','trusted_automated_import','approved_screenshot_import',
    'approved_manual_entry','unreviewed_extraction','external_cfb_baseline'
  )),
  reviewed_by_user_id uuid references public.rec_users(id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_import_records enable row level security;
create index if not exists rec_import_records_job_idx on public.rec_import_records(import_job_id);
create index if not exists rec_import_records_league_status_idx on public.rec_import_records(league_id, status);
create index if not exists rec_import_records_entity_idx on public.rec_import_records(league_id, record_type, entity_key);

-- Field-level provenance (master plan §4.3 FieldProvenance) — one row per extracted field
-- within a record, carrying both what was extracted and what a reviewer approved (which can
-- differ after a correction).
create table if not exists public.rec_import_fields (
  id uuid primary key default gen_random_uuid(),
  import_record_id uuid not null references public.rec_import_records(id) on delete cascade,
  field_key text not null,
  source_type text not null check (source_type in ('cfb_screenshot','cfb_baseline','madden_companion','madden_direct_sync','manual')),
  source_path text,
  source_region jsonb,
  adapter_key text not null,
  adapter_version text not null,
  confidence numeric,
  extracted_value jsonb,
  approved_value jsonb,
  approved_by_user_id uuid references public.rec_users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (import_record_id, field_key)
);
alter table public.rec_import_fields enable row level security;
create index if not exists rec_import_fields_record_idx on public.rec_import_fields(import_record_id);

-- A detected conflict between this import and existing canonical data (or another source of
-- higher/equal trust). Trust level guides review but never silently resolves a material
-- conflict (master plan §4.4) — every row here starts 'pending' and stays that way until a
-- human (or an explicit trusted-import-wins policy on the Madden side, Phase 3) resolves it.
create table if not exists public.rec_import_conflicts (
  id uuid primary key default gen_random_uuid(),
  import_record_id uuid not null references public.rec_import_records(id) on delete cascade,
  field_key text not null,
  incoming_value jsonb,
  existing_value jsonb,
  existing_source text,
  resolution text not null default 'pending' check (resolution in ('pending','kept_existing','accepted_import','manual_override')),
  resolved_by_user_id uuid references public.rec_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.rec_import_conflicts enable row level security;
create index if not exists rec_import_conflicts_record_idx on public.rec_import_conflicts(import_record_id);
create index if not exists rec_import_conflicts_pending_idx on public.rec_import_conflicts(resolution) where resolution = 'pending';

-- A human edit to an already-extracted field value — distinct from the original extraction
-- (rec_import_fields.extracted_value) so "what did OCR say" and "what did the commissioner
-- change it to, and why" both survive independently.
create table if not exists public.rec_import_corrections (
  id uuid primary key default gen_random_uuid(),
  import_field_id uuid not null references public.rec_import_fields(id) on delete cascade,
  previous_value jsonb,
  corrected_value jsonb,
  corrected_by_user_id uuid references public.rec_users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.rec_import_corrections enable row level security;
create index if not exists rec_import_corrections_field_idx on public.rec_import_corrections(import_field_id);

-- Registry of adapter code versions actually used — reproducibility (a record's adapter_key
-- + adapter_version tells you exactly which parser logic produced it) and a place to record
-- when a version was retired.
create table if not exists public.rec_import_adapter_versions (
  id uuid primary key default gen_random_uuid(),
  adapter_key text not null,
  version text not null,
  description text,
  released_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (adapter_key, version)
);
alter table public.rec_import_adapter_versions enable row level security;

-- General audit trail across the whole pipeline — every meaningful state transition, not just
-- record-level review (rec_import_records already tracks its own reviewed_by/reviewed_at).
create table if not exists public.rec_import_audit_log (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid references public.rec_import_jobs(id) on delete cascade,
  actor_user_id uuid references public.rec_users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_import_audit_log enable row level security;
create index if not exists rec_import_audit_log_job_idx on public.rec_import_audit_log(import_job_id, created_at desc);

revoke all on table public.rec_import_connections from anon, authenticated;
revoke all on table public.rec_import_jobs from anon, authenticated;
revoke all on table public.rec_import_files from anon, authenticated;
revoke all on table public.rec_import_payloads from anon, authenticated;
revoke all on table public.rec_import_records from anon, authenticated;
revoke all on table public.rec_import_fields from anon, authenticated;
revoke all on table public.rec_import_conflicts from anon, authenticated;
revoke all on table public.rec_import_corrections from anon, authenticated;
revoke all on table public.rec_import_adapter_versions from anon, authenticated;
revoke all on table public.rec_import_audit_log from anon, authenticated;
