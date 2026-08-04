-- Trade Center backlog (#44) — competition-committee review.
-- One native Discord poll per trade under review, voted on by the head commissioner (guild
-- owner) + every co-commissioner. eligible_voter_discord_ids snapshots that roster at poll
-- creation so a mid-vote role change can't change who counted. The bot polls Discord's live
-- vote count on an interval (see apps/bot's trade-committee scheduler) and closes the poll
-- the moment every eligible voter has voted, without waiting for closes_at — same table
-- covers the normal closes_at timeout path too. A tied vote defers to the head
-- commissioner's own vote as the final ruling (decided_by distinguishes the two paths).
create table if not exists public.rec_trade_committee_polls (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.rec_trades(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  guild_id text not null,
  discord_channel_id text not null,
  discord_message_id text not null,
  head_commissioner_discord_id text not null,
  eligible_voter_discord_ids jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'closed')),
  result text check (result in ('approve', 'deny')),
  decided_by text check (decided_by in ('unanimous', 'early_full_turnout', 'timeout_vote', 'head_commissioner_tiebreak')),
  vote_counts jsonb,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_id)
);

alter table public.rec_trade_committee_polls enable row level security;

create index if not exists rec_trade_committee_polls_status_idx on public.rec_trade_committee_polls (status, closes_at);
