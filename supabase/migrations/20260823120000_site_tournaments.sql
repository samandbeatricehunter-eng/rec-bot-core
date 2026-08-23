-- Site-hosted tournaments (brackets + coin payouts). API-only access; RLS on, no anon policies.

create table if not exists public.rec_site_tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  game text not null check (game in ('madden_26', 'madden_27', 'cfb_27')),
  bracket_type text not null,
  payout_scope text not null check (payout_scope in ('winner', 'final_two', 'final_four')),
  winner_coins integer not null default 0 check (winner_coins >= 0),
  runner_up_coins integer not null default 0 check (runner_up_coins >= 0),
  semifinalist_coins integer not null default 0 check (semifinalist_coins >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'locked', 'complete', 'cancelled')),
  created_by_user_id uuid not null references public.rec_users(id),
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  payouts_issued_at timestamptz
);
alter table public.rec_site_tournaments enable row level security;
create index if not exists rec_site_tournaments_status_idx
  on public.rec_site_tournaments (status, created_at desc);

create table if not exists public.rec_site_tournament_entrants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  seed integer,
  joined_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);
alter table public.rec_site_tournament_entrants enable row level security;
create index if not exists rec_site_tournament_entrants_user_idx
  on public.rec_site_tournament_entrants (user_id);

create table if not exists public.rec_site_tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  bracket_key text not null,
  bracket_side text not null default 'winners'
    check (bracket_side in ('winners', 'losers', 'grand_final')),
  round integer not null,
  slot integer not null,
  player_a_user_id uuid references public.rec_users(id),
  player_b_user_id uuid references public.rec_users(id),
  winner_user_id uuid references public.rec_users(id),
  feeds_winner_match_id uuid references public.rec_site_tournament_matches(id),
  feeds_winner_slot text check (feeds_winner_slot in ('a', 'b')),
  feeds_loser_match_id uuid references public.rec_site_tournament_matches(id),
  feeds_loser_slot text check (feeds_loser_slot in ('a', 'b')),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'complete', 'bye')),
  unique (tournament_id, bracket_key)
);
alter table public.rec_site_tournament_matches enable row level security;
create index if not exists rec_site_tournament_matches_tourney_idx
  on public.rec_site_tournament_matches (tournament_id, bracket_side, round, slot);
