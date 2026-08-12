-- Enhance rec_admin_incidents for centralized 5xx capture, pattern tracking, and workorders.
--
-- Every 5xx error will now be auto-logged in sendError with a fingerprint (hash of
-- process+errorName+errorMessage+leagueId) so repeats increment occurrence_count and
-- update last_seen_at instead of spamming new rows. An admin can resolve/ignore an
-- incident and start a tracked workorder (message the commish) with a status trail.

-- Fingerprint for dedup: same error from the same league/process is one row, not N rows.
alter table public.rec_admin_incidents add column if not exists fingerprint text;
-- How many times this fingerprint has fired (1 on first occurrence, incremented on repeats).
alter table public.rec_admin_incidents add column if not exists occurrence_count integer not null default 1;
-- When the fingerprint was first and most recently seen (for pattern/volume tracking).
alter table public.rec_admin_incidents add column if not exists first_seen_at timestamptz not null default now();
alter table public.rec_admin_incidents add column if not exists last_seen_at timestamptz not null default now();

-- Workorder tracking: when an admin starts a workorder (message the commish), the
-- conversation_id and a status trail are recorded on the incident.
alter table public.rec_admin_incidents add column if not exists workorder_status text not null default 'none';
alter table public.rec_admin_incidents add column if not exists workorder_conversation_id uuid;
alter table public.rec_admin_incidents add column if not exists workorder_started_at timestamptz;
alter table public.rec_admin_incidents add column if not exists workorder_started_by uuid references public.rec_users(id) on delete set null;
alter table public.rec_admin_incidents add column if not exists workorder_note text;

-- Index for fingerprint lookup (dedup upsert).
create index if not exists rec_admin_incidents_fingerprint_idx
  on public.rec_admin_incidents(fingerprint, status);

-- Index for volume/pattern queries (by status + time range).
create index if not exists rec_admin_incidents_status_time_idx
  on public.rec_admin_incidents(status, last_seen_at desc);

-- Index for pattern grouping (by process + severity).
create index if not exists rec_admin_incidents_process_severity_idx
  on public.rec_admin_incidents(process, severity, status);

-- Backfill fingerprint + first_seen_at for existing rows so the new columns are
-- non-null and queryable. Existing open incidents get a synthetic fingerprint.
update public.rec_admin_incidents
set fingerprint = md5(coalesce(process, '') || '|' || coalesce(error_name, '') || '|' || coalesce(error_message, '') || '|' || coalesce(league_id::text, ''))
where fingerprint is null;

update public.rec_admin_incidents
set first_seen_at = occurred_at
where first_seen_at = now() and occurred_at is not null;

-- Make fingerprint non-null now that existing rows are backfilled.
alter table public.rec_admin_incidents alter column fingerprint set not null;
