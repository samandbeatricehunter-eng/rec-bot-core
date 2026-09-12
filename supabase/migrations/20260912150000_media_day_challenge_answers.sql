-- Media Day rebuild Phase D: records each answer the user actually gave, frozen at submit time
-- (wording + semantic intent) so a later content-bank edit can never retroactively change what a
-- past answer said -- same "freeze on gate creation" rule answer_bank.json's own rules block
-- specifies. side/challenge_id are set for the non-RTI weekly-challenge-tied questions (one row
-- per side); left null for any future subject/question kind that isn't challenge-tied.
--
-- Named rec_media_day_CHALLENGE_answers, not rec_media_day_answers -- that name is already taken
-- by the existing, still-live, unrelated non-RTI Media Day modal (hub.service.ts's
-- getNonRtiMediaDay/submitNonRtiMediaDayAnswer), which this gate does not touch or replace yet.
create table if not exists public.rec_media_day_challenge_answers (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.rec_media_day_periods(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  subject_key text not null,
  side text,
  challenge_id text,
  question_id text not null,
  question_text text not null,
  answer_key text not null,
  answer_text text not null,
  answer_intent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (period_id, user_id, subject_key, side)
);
alter table public.rec_media_day_challenge_answers enable row level security;
create index if not exists rec_media_day_challenge_answers_period_user_idx
  on public.rec_media_day_challenge_answers (period_id, user_id);
