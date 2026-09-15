-- Marks a league as mid-advance so the Media Day gate (and anything else gated on a
-- fully-settled current_week/season_stage) can suppress itself uniformly for every user,
-- including the commissioner running the advance, until completeAdvanceWeek finishes.
alter table public.rec_leagues
  add column if not exists advance_in_progress_since timestamptz null;
