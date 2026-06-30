-- Wager sportsbook: users bet the house (auto-derived lines) or each other (peer
-- wagers). Stakes are escrowed out of the wallet on placement; payouts/refunds are
-- credited on settlement/cancel. Pending payouts post to the pending-payouts channel
-- and only settle once the game outcome is confirmed (box score / weekly scores /
-- advance result). rec_wager_legs backs 3-pick parlays.
create table if not exists public.rec_wagers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  game_id uuid,
  placed_by_user_id uuid not null,
  placed_by_discord_id text,
  wager_kind text not null default 'house',          -- 'house' | 'peer'
  counterparty_user_id uuid,                          -- target user for a direct peer challenge
  accepted_by_user_id uuid,                            -- who took an open/direct peer wager
  accepted_by_discord_id text,
  challenge_type text,                                -- 'open' | 'direct' for peer wagers
  market text not null,                               -- WAGER_MARKETS key, or 'parlay'
  pick text not null,                                 -- team_id | 'over' | 'under'
  line numeric,
  odds numeric not null default 1,
  stake integer not null,
  potential_payout integer not null default 0,
  status text not null default 'pending',            -- awaiting_accept|pending|confirmed|won|lost|push|refunded|cancelled
  is_parlay boolean not null default false,
  hold_ledger_id uuid,
  payout_ledger_id uuid,
  pending_channel_id text,
  pending_message_id text,
  announcement_channel_id text,
  announcement_message_id text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_wagers enable row level security;

create index if not exists rec_wagers_league_week_idx
  on public.rec_wagers (league_id, season_number, week_number);
create index if not exists rec_wagers_game_idx
  on public.rec_wagers (game_id);
create index if not exists rec_wagers_user_idx
  on public.rec_wagers (league_id, placed_by_user_id, season_number, week_number);

-- No duplicate (game, market) house/single wager per user per week (parlays exempt).
create unique index if not exists rec_wagers_no_duplicate_idx
  on public.rec_wagers (league_id, season_number, week_number, placed_by_user_id, game_id, market)
  where is_parlay = false
    and status in ('awaiting_accept', 'pending', 'confirmed');

create table if not exists public.rec_wager_legs (
  id uuid primary key default gen_random_uuid(),
  wager_id uuid not null references public.rec_wagers(id) on delete cascade,
  game_id uuid,
  market text not null,
  pick text not null,
  line numeric,
  odds numeric not null default 1,
  leg_result text,                                    -- null | 'won' | 'lost' | 'push'
  created_at timestamptz not null default now()
);

alter table public.rec_wager_legs enable row level security;

create index if not exists rec_wager_legs_wager_idx
  on public.rec_wager_legs (wager_id);
