-- Persisted "current record holder" per (league, scope, postseason flag, stat key) — distinct
-- from the live top-10 leaderboards League Records renders (those recompute on every page
-- load). This table is what makes a record something a coach can *hold*: it's only replaced
-- when a strictly higher value is set, and it's what the season-end payout step reads to pay
-- the 1x, 500-coin bonus to whoever holds each game/season record at the close of a season —
-- re-paid every season the same coach still holds it, per the confirmed spec.
create table if not exists rec_league_record_holders (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references rec_leagues(id) on delete cascade,
  scope text not null check (scope in ('game','season','career')),
  postseason boolean not null default false,
  stat_key text not null,
  player_id uuid not null references rec_players(id) on delete cascade,
  user_id uuid references rec_users(id) on delete set null,
  team_id uuid references rec_teams(id) on delete set null,
  value numeric not null,
  season_number integer,
  week_number integer,
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, scope, postseason, stat_key)
);
alter table rec_league_record_holders enable row level security;

-- Tracks which (league, season, scope, postseason, stat_key) combos have already had their
-- holding-bonus paid for a given season, so re-running the season-end payout step (or a
-- commissioner retrying a failed advance) can never double-pay the same record twice.
create table if not exists rec_league_record_bonus_payouts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references rec_leagues(id) on delete cascade,
  season_number integer not null,
  scope text not null check (scope in ('game','season')),
  postseason boolean not null default false,
  stat_key text not null,
  user_id uuid not null references rec_users(id) on delete cascade,
  amount integer not null,
  paid_at timestamptz not null default now(),
  unique (league_id, season_number, scope, postseason, stat_key)
);
alter table rec_league_record_bonus_payouts enable row level security;
