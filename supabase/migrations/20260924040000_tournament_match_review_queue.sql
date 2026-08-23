-- Player-submitted match results now go to a "pending_review" holding state instead of applying
-- immediately (bracket advance, wager settlement, records) -- an admin must approve before it
-- takes effect. Admin-submitted results are unaffected (they still apply immediately, same as
-- today, since an admin is already a trusted actor).
alter table public.rec_site_tournament_matches
  drop constraint rec_site_tournament_matches_status_check;
alter table public.rec_site_tournament_matches
  add constraint rec_site_tournament_matches_status_check
  check (status in ('pending', 'ready', 'pending_review', 'complete', 'bye'));

-- "opponent_quit" is distinct from "concede": a concede is the opponent explicitly conceding
-- (in-game concede screen or a clear statement), while a quit-out is the opponent disconnecting
-- / rage-quitting without formally conceding.
alter table public.rec_site_tournament_matches
  drop constraint rec_site_tournament_matches_result_method_check;
alter table public.rec_site_tournament_matches
  add constraint rec_site_tournament_matches_result_method_check
  check (result_method is null or result_method in ('final_screenshot', 'concede', 'opponent_quit', 'bye'));

alter table public.rec_site_tournament_matches
  add column if not exists submitted_by_user_id uuid references public.rec_users(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by_user_id uuid references public.rec_users(id),
  add column if not exists reviewed_at timestamptz;
