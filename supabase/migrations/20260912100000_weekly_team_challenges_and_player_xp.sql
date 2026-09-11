-- Phase 3 of the media/tweets/challenges rebuild (see
-- C:\Users\josh_\.claude\plans\refactored-swimming-token.md): non-RTI weekly TEAM challenges,
-- mirroring rec_immortality_issued_challenges' frozen-issuance pattern (challenge-issuance.service.ts)
-- but scoped to a team's game instead of one RTI prospect's stat line -- see
-- packages/shared/src/weekly-challenges/conditions.ts for why this is team-level.
--
-- Also lands the real (not throwaway) non-RTI Player XP ledger from
-- docs/handoff/docs/PLAYER_XP_REWARDS.md's "Data model" section, field-for-field, so weekly
-- challenges pay into the same permanent currency the full weekly-stat-line/percentile/streak/
-- season-award scoring engine will use once that separate, much larger project is built. Only the
-- schema is implemented here -- "weekly_challenge" is the first event_type to write into it.

create table if not exists public.rec_weekly_team_challenges_issued (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  side text not null check (side in ('offense', 'defense', 'special_teams')),
  challenge_id text not null,
  name text not null,
  bronze jsonb not null,
  silver_adds jsonb not null,
  gold_adds jsonb not null,
  created_at timestamptz not null default now(),
  unique (league_id, team_id, season_number, week_number, side)
);
alter table public.rec_weekly_team_challenges_issued enable row level security;
create index if not exists rec_weekly_team_challenges_issued_team_idx
  on public.rec_weekly_team_challenges_issued (league_id, team_id, season_number, week_number);

create table if not exists public.rec_player_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  player_id uuid not null references public.rec_players(id) on delete cascade,
  credited_to_user_id uuid references public.rec_users(id) on delete set null,
  season_number integer not null,
  week_number integer,
  event_type text not null,
  source_id text not null,
  raw_xp numeric not null,
  dev_trait_at_event text,
  dev_multiplier numeric not null default 1,
  rivalry_multiplier numeric not null default 1,
  other_multiplier numeric not null default 1,
  awarded_xp integer not null,
  remainder_before numeric not null default 0,
  remainder_after numeric not null default 0,
  formula_version text not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_player_xp_ledger enable row level security;
create index if not exists rec_player_xp_ledger_player_idx on public.rec_player_xp_ledger (league_id, player_id, created_at desc);

create table if not exists public.rec_player_xp_state (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  player_id uuid not null references public.rec_players(id) on delete cascade,
  balance_xp numeric not null default 0,
  lifetime_earned_xp numeric not null default 0,
  lifetime_spent_xp numeric not null default 0,
  fractional_remainder numeric not null default 0,
  last_award_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (league_id, player_id)
);
alter table public.rec_player_xp_state enable row level security;
