-- GOTW guessing-record tracking: win/loss/tie per vote (rec_global_gotw_guessing_records only
-- ever tracked correct/wrong, with a tied game silently skipped entirely — is_correct is null
-- for a tie, and the settlement loop explicitly `continue`s on a null is_correct). Add an
-- explicit is_tie flag so a tied game logs as a real outcome instead of vanishing.
alter table rec_game_of_week_votes add column if not exists is_tie boolean not null default false;

-- Per-league, per-season guessing record — distinct from the existing global/lifetime table,
-- since the season-end top-3 bonus is scoped to "this league, this season," not a coach's
-- all-time record across every league they've ever played in.
create table if not exists rec_league_gotw_guessing_records (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references rec_leagues(id) on delete cascade,
  season_number integer not null,
  user_id uuid not null references rec_users(id) on delete cascade,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  last_result_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, user_id)
);
alter table rec_league_gotw_guessing_records enable row level security;

-- Idempotency guard for the season-end top-3 bonus payout, same pattern as
-- rec_league_record_bonus_payouts.
create table if not exists rec_gotw_guessing_bonus_payouts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references rec_leagues(id) on delete cascade,
  season_number integer not null,
  user_id uuid not null references rec_users(id) on delete cascade,
  rank integer not null,
  amount integer not null,
  paid_at timestamptz not null default now(),
  unique (league_id, season_number, user_id)
);
alter table rec_gotw_guessing_bonus_payouts enable row level security;
