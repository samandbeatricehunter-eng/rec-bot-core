-- Unified weekly challenge assignments V2.
-- Forward-only foundation for REC_Media_Social_Challenge_Overhaul_FINAL:
-- standard owner assignments and RTI owner/prospect assignments use the same frozen record,
-- while legacy issued tables remain in place until every caller/history view is migrated.

create table if not exists public.rec_weekly_challenge_assignments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  league_mode text not null check (league_mode in ('STANDARD', 'RTI')),
  assignment_class text not null check (assignment_class in ('TEAM', 'PLAYER')),
  subject_key text not null,
  subject_label text,
  user_id uuid references public.rec_users(id) on delete set null,
  team_id uuid references public.rec_teams(id) on delete set null,
  game_id uuid references public.rec_games(id) on delete set null,
  opponent_team_id uuid references public.rec_teams(id) on delete set null,
  target_player_id uuid references public.rec_players(id) on delete set null,
  target_prospect_id uuid references public.rec_immortality_prospects(id) on delete set null,
  challenge_id text not null,
  challenge_version integer not null,
  challenge_name text not null,
  challenge_family text not null,
  challenge_side text,
  challenge_pool text,
  challenge_volatility text,
  bronze jsonb not null,
  silver_adds jsonb not null,
  gold_adds jsonb not null,
  reason_codes text[] not null default '{}',
  context_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'issued'
    check (status in ('issued', 'graded', 'credited', 'void')),
  void_reason text,
  graded_tier text check (graded_tier in ('bronze', 'silver', 'gold')),
  credited_tier text check (credited_tier in ('bronze', 'silver', 'gold')),
  formula_version text not null default 'rec-weekly-challenges-unified-v2',
  issued_at timestamptz not null default now(),
  graded_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, week_number, user_id, subject_key)
);

alter table public.rec_weekly_challenge_assignments enable row level security;

create index if not exists rec_weekly_challenge_assignments_league_week_idx
  on public.rec_weekly_challenge_assignments (league_id, season_number, week_number);

create index if not exists rec_weekly_challenge_assignments_user_idx
  on public.rec_weekly_challenge_assignments (league_id, user_id, season_number, week_number);

create index if not exists rec_weekly_challenge_assignments_player_idx
  on public.rec_weekly_challenge_assignments (target_player_id, season_number, week_number)
  where target_player_id is not null;

create index if not exists rec_weekly_challenge_assignments_prospect_idx
  on public.rec_weekly_challenge_assignments (target_prospect_id, season_number, week_number)
  where target_prospect_id is not null;
