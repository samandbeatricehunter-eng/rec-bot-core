-- Rise to Immortality: weekly owner "Media Day" questions, mirroring the player-side matchup
-- interview but simplified -- owners aren't tied to a specific weekly matchup/opponent the way a
-- prospect is, so this skips the reactive-to-opponent slot and bonus-claim/rivalry mechanics
-- entirely (just 3 static ownership-perspective questions per week, drifting owner persona).
create table if not exists public.rec_immortality_owner_interview_answers (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  owner_id uuid not null references public.rec_immortality_owners(id) on delete cascade,
  season integer not null,
  week_number integer not null,
  slot integer not null,
  question_id integer not null,
  rendered_question jsonb not null,
  option_index integer not null,
  dna_points jsonb not null default '{}'::jsonb,
  formula_version text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, week_number, slot)
);
alter table public.rec_immortality_owner_interview_answers enable row level security;
create index if not exists rec_immortality_owner_interview_answers_league_idx
  on public.rec_immortality_owner_interview_answers(immortality_league_id);
