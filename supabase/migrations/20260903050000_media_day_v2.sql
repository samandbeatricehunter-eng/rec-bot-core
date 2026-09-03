-- Media Day v2: serve 3 questions/week (was 1) with a slot per question, link each answer to
-- the specific game it's about (so results can auto-resolve bonus/backfire once EA-imported
-- stats land for that game), track who the answering side's opponent is (for reactive
-- questions and headline tagging), and track when a pending claim got resolved.
alter table rec_immortality_matchup_interview_answers
  drop constraint if exists rec_immortality_matchup_interview_a_prospect_id_week_number_key;

alter table rec_immortality_matchup_interview_answers
  add column if not exists slot integer not null default 1,
  add column if not exists game_id uuid references rec_games(id) on delete set null,
  add column if not exists opponent_prospect_id uuid references rec_immortality_prospects(id) on delete set null,
  add column if not exists resolved_at timestamptz;

alter table rec_immortality_matchup_interview_answers
  add constraint rec_immortality_matchup_interview_answers_prospect_week_slot_key unique (prospect_id, week_number, slot);

create index if not exists rec_immortality_matchup_interview_answers_game_idx
  on rec_immortality_matchup_interview_answers (game_id) where bonus_status = 'pending';
