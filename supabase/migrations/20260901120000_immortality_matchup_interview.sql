create table if not exists rec_immortality_matchup_interview_answers (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references rec_immortality_leagues(id) on delete cascade,
  prospect_id uuid not null references rec_immortality_prospects(id) on delete cascade,
  side text not null check (side in ('offense', 'defense')),
  season integer,
  week_number integer,
  question_id integer not null,
  option_index integer not null,
  dna_points jsonb not null default '{}'::jsonb,
  bonus_stat_category_hint text,
  bonus_xp_pct integer,
  bonus_status text not null default 'none' check (bonus_status in ('none', 'pending', 'met', 'missed')),
  formula_version text not null,
  created_at timestamptz not null default now(),
  unique (prospect_id, week_number)
);

alter table rec_immortality_matchup_interview_answers enable row level security;

create index if not exists rec_immortality_matchup_interview_answers_league_idx
  on rec_immortality_matchup_interview_answers (immortality_league_id);
