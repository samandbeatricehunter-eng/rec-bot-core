-- Adds "rookie" (Rise to Immortality's 3-round rookie draft) as a legal draft_type alongside
-- the existing fantasy/offseason values.
alter table public.rec_fantasy_draft_sessions
  drop constraint if exists rec_fantasy_draft_sessions_draft_type_check;
alter table public.rec_fantasy_draft_sessions
  add constraint rec_fantasy_draft_sessions_draft_type_check
  check (draft_type = any (array['fantasy'::text, 'offseason'::text, 'rookie'::text]));
