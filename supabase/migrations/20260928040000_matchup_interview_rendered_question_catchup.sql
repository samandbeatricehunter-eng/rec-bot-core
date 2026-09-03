-- rendered_question was added to the live database by hand at some point (immortality.service.ts
-- has read/written it since Media Day v2) without a tracked migration file -- this brings the
-- tracked migrations back in sync with reality, per this repo's own CLAUDE.md convention.
alter table public.rec_immortality_matchup_interview_answers add column if not exists rendered_question jsonb;
