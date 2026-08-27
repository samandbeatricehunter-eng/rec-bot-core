create table if not exists public.rec_stream_capture_jobs (
  id uuid primary key default gen_random_uuid(),
  streaming_session_id uuid not null unique references public.rec_streaming_sessions(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  stream_url text not null,
  status text not null default 'pending' check (status in ('pending','capturing','stop_requested','processing','completed','retry','failed','awaiting_configuration')),
  capture_path text,
  attempt_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_stream_capture_jobs enable row level security;
create index if not exists rec_stream_capture_jobs_status_idx on public.rec_stream_capture_jobs(status, created_at);

create table if not exists public.rec_stream_event_clips (
  id uuid primary key default gen_random_uuid(),
  capture_job_id uuid not null references public.rec_stream_capture_jobs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  event_type text not null,
  event_second numeric not null,
  away_score integer,
  home_score integer,
  quarter text,
  game_clock text,
  down_distance text,
  yard_line integer,
  possession text,
  cloudflare_stream_uid text,
  playback_url text,
  ocr_payload jsonb not null default '{}'::jsonb,
  selected_for_recap boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.rec_stream_event_clips enable row level security;
create unique index if not exists rec_stream_event_clips_job_second_idx on public.rec_stream_event_clips(capture_job_id, event_second, event_type);
create index if not exists rec_stream_event_clips_week_idx on public.rec_stream_event_clips(league_id, season_number, week_number, selected_for_recap);

create table if not exists public.rec_weekly_recap_jobs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','retry','failed','awaiting_assets')),
  output_stream_uid text,
  playback_url text,
  last_error text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, week_number)
);
alter table public.rec_weekly_recap_jobs enable row level security;
create index if not exists rec_weekly_recap_jobs_status_idx on public.rec_weekly_recap_jobs(status, created_at);

grant select, insert, update, delete on public.rec_stream_capture_jobs, public.rec_stream_event_clips, public.rec_weekly_recap_jobs to service_role;
