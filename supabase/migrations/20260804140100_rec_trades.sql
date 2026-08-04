-- New ledger source for trade coin transfers (see apply_trade RPC).
alter type public.rec_source_type add value if not exists 'trade';

-- Trade Center backlog (#44) — trade proposals between two Madden rosters.
-- Lifecycle: pending_response (awaiting the receiving GM) -> accepted -> either applied
-- immediately (no_approval_required) or pending_review (commissioner_review /
-- competition_committee_review) -> applied. Any stage before applied can end in declined /
-- withdrawn / rejected. approval_policy_snapshot freezes the league's trade_approval_policy
-- at propose time so a mid-review settings change can't retroactively change how an
-- in-flight trade gets decided.
create table if not exists public.rec_trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  proposing_team_id uuid not null references public.rec_teams(id) on delete cascade,
  proposing_user_id uuid not null references public.rec_users(id) on delete cascade,
  receiving_team_id uuid not null references public.rec_teams(id) on delete cascade,
  receiving_user_id uuid not null references public.rec_users(id) on delete cascade,
  -- Coins offered on top of the up-to-7 player/pick slots per side (slot cap enforced in the
  -- API, not here — same pattern as the commissioner-poll option cap).
  proposing_coins integer not null default 0 check (proposing_coins >= 0),
  receiving_coins integer not null default 0 check (receiving_coins >= 0),
  status text not null default 'pending_response'
    check (status in ('pending_response', 'accepted', 'pending_review', 'applied', 'declined', 'withdrawn', 'rejected')),
  approval_policy_snapshot text not null,
  proposing_coins_ledger_id uuid references public.rec_dollar_ledger(id),
  receiving_coins_ledger_id uuid references public.rec_dollar_ledger(id),
  reviewed_by_discord_id text,
  review_note text,
  proposed_at timestamptz not null default now(),
  accepted_at timestamptz,
  applied_at timestamptz,
  declined_at timestamptz,
  withdrawn_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_trades enable row level security;

create index if not exists rec_trades_league_status_idx on public.rec_trades (league_id, status);
create index if not exists rec_trades_proposing_team_idx on public.rec_trades (proposing_team_id);
create index if not exists rec_trades_receiving_team_idx on public.rec_trades (receiving_team_id);

-- One row per player or draft pick moving in the trade. Exactly one of player_id /
-- draft_pick_id is set, matching leg_type.
create table if not exists public.rec_trade_legs (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.rec_trades(id) on delete cascade,
  leg_type text not null check (leg_type in ('player', 'pick')),
  player_id uuid references public.rec_players(id) on delete cascade,
  draft_pick_id uuid references public.rec_draft_picks(id) on delete cascade,
  from_team_id uuid not null references public.rec_teams(id) on delete cascade,
  to_team_id uuid not null references public.rec_teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint rec_trade_legs_leg_shape check (
    (leg_type = 'player' and player_id is not null and draft_pick_id is null) or
    (leg_type = 'pick' and draft_pick_id is not null and player_id is null)
  )
);

alter table public.rec_trade_legs enable row level security;

create index if not exists rec_trade_legs_trade_idx on public.rec_trade_legs (trade_id);

-- Append-only history, same pattern as rec_custom_player_audit_log.
create table if not exists public.rec_trade_audit_log (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.rec_trades(id) on delete cascade,
  action text not null,
  actor_user_id uuid references public.rec_users(id),
  actor_discord_id text,
  previous_status text,
  next_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.rec_trade_audit_log enable row level security;

create index if not exists rec_trade_audit_log_trade_idx on public.rec_trade_audit_log (trade_id);
