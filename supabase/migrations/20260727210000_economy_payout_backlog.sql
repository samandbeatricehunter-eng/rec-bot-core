-- Holds payouts that would otherwise be issued by a payout-granting flow (box score,
-- wager, highlight, stream, badge bonus, EOS payout/award, etc.) while a league is under
-- the coin-economy's minimum linked-user floor (see REC_ECONOMY_MINIMUM_LINKED_USERS).
-- The triggering notification/approval workflow still fires normally; only the actual
-- wallet credit is deferred here until the league crosses the floor, at which point every
-- unreleased row for that league+season is bulk-credited and the user gets an itemized
-- notification of what they were paid for. Scoped per season — advancing to a new season
-- wipes any rows still unreleased instead of carrying them forward.

create table public.rec_economy_payout_backlog (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  amount integer not null,
  description text not null,
  transaction_type text not null,
  source rec_source_type not null,
  source_reference jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index rec_economy_payout_backlog_league_season_idx
  on public.rec_economy_payout_backlog (league_id, season_number)
  where released_at is null;

create index rec_economy_payout_backlog_user_idx
  on public.rec_economy_payout_backlog (user_id);

alter table public.rec_economy_payout_backlog enable row level security;
