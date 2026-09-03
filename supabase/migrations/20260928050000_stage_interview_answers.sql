-- Stage-aware Media Day interviews for non-gameplay season stages (preseason/training camp,
-- draft, free agency, transfer portal, etc.) -- a separate table from
-- rec_immortality_matchup_interview_answers because that table's shape (game_id,
-- opponent_prospect_id, bonus-claim resolution) is inherently matchup-specific and its existing
-- unique constraint has no `season` column, which would risk a real collision retrofitting stage
-- content onto it across a prospect's multiple seasons. One question per (prospect, season,
-- season_stage, advance_index) -- advance_index is rec_leagues.current_week at ask time, already
-- the per-stage advance counter nextLeagueStage (packages/shared/src/league-stage.ts) uses for
-- multi-advance stages like CFB's transfer_portal window.
create table if not exists public.rec_immortality_stage_interview_answers (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  side text not null,
  season integer not null,
  season_stage text not null,
  advance_index integer not null default 1,
  question_id integer not null,
  option_index integer not null,
  dna_points jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (prospect_id, season, season_stage, advance_index)
);
alter table public.rec_immortality_stage_interview_answers enable row level security;

create index if not exists rec_immortality_stage_interview_answers_prospect_idx
  on public.rec_immortality_stage_interview_answers (prospect_id, season, season_stage);
