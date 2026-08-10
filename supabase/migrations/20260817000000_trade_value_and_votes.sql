-- Persisted fairness-report snapshot on each trade (computed once at propose/accept time so
-- review UIs show a stable value even if rosters change later), and per-commissioner vote
-- tracking for competition-committee-review leagues.
alter table rec_trades add column if not exists value_snapshot jsonb;

create table if not exists rec_trade_votes (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references rec_trades(id) on delete cascade,
  voter_user_id uuid not null references rec_users(id) on delete cascade,
  voter_discord_id text,
  vote text not null check (vote in ('approve', 'reject')),
  voted_at timestamptz not null default now(),
  unique (trade_id, voter_user_id)
);

alter table rec_trade_votes enable row level security;
