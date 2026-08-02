-- Heisman Race winner/close state, one row per league+season. Presence of awarded_at means
-- the race is closed for that season — add/remove candidate actions check this row.
-- New season_number automatically reopens the race (no row yet), no explicit "reopen" needed.
create table if not exists public.rec_heisman_race_state (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  winner_candidate_id uuid references public.rec_heisman_candidates(id) on delete set null,
  awarded_user_id uuid references public.rec_users(id) on delete set null,
  awarded_at timestamptz,
  awarded_by_user_id uuid references public.rec_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (league_id, season_number)
);
alter table public.rec_heisman_race_state enable row level security;

-- Heisman award payouts route through add_to_wallet's p_source, which is constrained to this
-- enum (same one rec_games.source and rec_dollar_ledger.source already use).
alter type public.rec_source_type add value if not exists 'heisman';
