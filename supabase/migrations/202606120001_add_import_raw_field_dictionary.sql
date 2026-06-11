create table if not exists public.rec_import_raw_field_dictionary (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  import_job_id uuid references public.rec_import_jobs(id) on delete set null,
  endpoint_key text not null,
  career_mode_get text,
  payload_group text not null default '',
  source_path text not null,
  raw_key text not null,
  value_type text not null,
  example_value jsonb,
  sample_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  rec_field_key text,
  rec_display_label text,
  rec_field_category text,
  rec_display_intent text,
  rec_notes text,
  mapped boolean not null default false,
  unique (league_id, endpoint_key, payload_group, source_path)
);

create index if not exists idx_rec_import_raw_field_dictionary_league
on public.rec_import_raw_field_dictionary (league_id, endpoint_key, mapped);

create index if not exists idx_rec_import_raw_field_dictionary_job
on public.rec_import_raw_field_dictionary (import_job_id);

create index if not exists idx_rec_import_raw_field_dictionary_path
on public.rec_import_raw_field_dictionary (source_path);
