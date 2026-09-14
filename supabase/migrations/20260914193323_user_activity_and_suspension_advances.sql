-- User-facing activity log (forward-looking; last-N reads start empty until events are recorded).
-- Suspension remaining_advances: Manage Users suspensions count down on league advance.

create table if not exists public.rec_user_activity_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues (id) on delete cascade,
  user_id uuid not null references public.rec_users (id) on delete cascade,
  team_id uuid references public.rec_teams (id) on delete set null,
  action_key text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rec_user_activity_events_league_user_created_idx
  on public.rec_user_activity_events (league_id, user_id, created_at desc);

alter table public.rec_user_activity_events enable row level security;

alter table public.rec_user_suspensions
  add column if not exists remaining_advances integer;

comment on column public.rec_user_suspensions.remaining_advances is
  'When set, suspension clears after this many successful league advances (Manage Users). Null = calendar ends_at only (legacy scheduling suspend).';
