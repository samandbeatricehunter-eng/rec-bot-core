create table if not exists public.rec_import_unknown_fields (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.rec_import_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  endpoint_key text not null,
  field_path text not null,
  sample_value jsonb,
  sample_payload jsonb not null default '{}'::jsonb,
  review_status text not null default 'needs_review',
  routing_notes text,
  created_at timestamptz not null default now(),
  unique(import_job_id, endpoint_key, field_path)
);

create index if not exists rec_import_unknown_fields_job_idx
  on public.rec_import_unknown_fields(import_job_id);
