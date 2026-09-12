-- Media Day gate (Post-Advance Experience, Phase B): tracks which week/stage "period" a league
-- has open for Media Day, and which users have completed it. The gate itself is feature-flagged
-- off (see MEDIA_DAY_GATE_ENABLED in media-day-gate.service.ts) until the full flow -- Rewards
-- Recap, the question banks, and answer-driven challenge targeting -- exists end to end; shipping
-- an enforcing gate before then would strand every user with no way to satisfy it.
create table if not exists public.rec_media_day_periods (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  season_stage text not null,
  advanced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (league_id, season_number, week_number, season_stage)
);
alter table public.rec_media_day_periods enable row level security;

create table if not exists public.rec_media_day_completions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.rec_media_day_periods(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  subject_key text not null,
  completed_at timestamptz not null default now(),
  unique (period_id, user_id, subject_key)
);
alter table public.rec_media_day_completions enable row level security;
create index if not exists rec_media_day_completions_period_user_idx
  on public.rec_media_day_completions (period_id, user_id);
