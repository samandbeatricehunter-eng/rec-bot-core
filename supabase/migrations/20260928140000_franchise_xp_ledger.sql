-- Franchise XP ledger (earning side), per docs/handoff-xp-progression/02_FRANCHISE/
-- FRANCHISE_XP_ENGINE.md and config/xp_economy.json's "franchise" section. Field-for-field
-- mirror of rec_player_xp_ledger / rec_player_xp_state (packages/shared's Player XP ledger),
-- one level up: user-owner-scoped (not player-scoped) Franchise Progress Points (FPP), with
-- team_id carried on each row for display/attribution context.
--
-- Ownership decision (the doc explicitly flags this as "must not guess"): FPP balances are
-- keyed by (league_id, user_id), not team_id. Rationale: every other REC economy ledger in this
-- codebase (rec_dollar_ledger, rec_player_xp_ledger, rec_immortality_team_xp_ledger) is
-- user-owner-scoped, and a team's roster/ownership can change hands mid-season (trade requests,
-- waitlists) while the owning user's progression should not reset. team_id is still recorded per
-- ledger row for context.
create table if not exists public.rec_franchise_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  season_number integer not null,
  week_number integer,
  event_type text not null,
  source_id text not null,
  raw_fpp integer not null,
  formula_version text not null default 'franchise_xp_ledger.v1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_type, source_id)
);
alter table public.rec_franchise_xp_ledger enable row level security;
create index if not exists rec_franchise_xp_ledger_user_idx on public.rec_franchise_xp_ledger(league_id, user_id);

create table if not exists public.rec_franchise_xp_state (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  balance_fpp integer not null default 0,
  lifetime_earned_fpp integer not null default 0,
  last_award_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.rec_franchise_xp_state enable row level security;
