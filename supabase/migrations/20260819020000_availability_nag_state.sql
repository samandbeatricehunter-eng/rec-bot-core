-- Tracks the one live "set your availability" nag message per league so the reminder poller can
-- delete-and-repost instead of stacking a fresh message every time a different user's due time
-- comes up -- the per-user reminder history in rec_scheduling_reminders_sent let the channel
-- accumulate several near-duplicate nags within minutes of each other whenever multiple users'
-- individual cooldowns happened to lapse close together.
create table if not exists public.rec_availability_nag_state (
  league_id uuid primary key references public.rec_leagues(id) on delete cascade,
  channel_id text not null,
  message_id text not null,
  posted_at timestamptz not null default now()
);
alter table public.rec_availability_nag_state enable row level security;
