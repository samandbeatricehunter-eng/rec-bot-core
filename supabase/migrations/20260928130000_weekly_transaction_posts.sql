-- Idempotency guard for the Weekly Transactions Discord embed (one per team, per advance):
-- postWeeklyTransactionsForAdvance claims a (league, season, week, user) slot by inserting here
-- before posting; a retried/duplicate advance call hits the unique constraint and skips instead
-- of double-posting.
create table if not exists public.rec_weekly_transaction_posts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default now(),
  unique (league_id, season_number, week_number, user_id)
);
alter table public.rec_weekly_transaction_posts enable row level security;
