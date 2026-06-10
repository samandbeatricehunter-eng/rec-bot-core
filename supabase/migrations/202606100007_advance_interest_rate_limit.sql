-- Track per-league savings interest rate limiting.
-- advance_rate_window_start / advance_rate_count: rolling 24-hour advance counter.
-- interest_disabled_until: set when advance count exceeds 21 in a 24h window.

alter table public.rec_leagues
  add column if not exists interest_disabled_until   timestamptz,
  add column if not exists advance_rate_window_start timestamptz,
  add column if not exists advance_rate_count        integer not null default 0;

alter table public.rec_leagues enable row level security;
