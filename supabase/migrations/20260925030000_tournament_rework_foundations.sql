-- Foundational schema for the tournament rework: a per-tournament logo + scheduling window
-- (unblocks the new edit-tournament surface), an explicit "who has to stream" column + a live
-- match status (unblocks stream-start linkage), scheduling-parity status values (check-in/
-- game-started/game-over/can't-make-game), and a match check-in table mirroring the league's
-- kickoff check-ins. Purely additive -- new nullable columns, widened check constraints, one new
-- table -- nothing existing breaks mid-rollout.

alter table public.rec_site_tournaments
  add column if not exists logo_url text,
  add column if not exists scheduling_window_hours integer not null default 48;

alter table public.rec_site_tournament_matches
  drop constraint rec_site_tournament_matches_status_check;
alter table public.rec_site_tournament_matches
  add constraint rec_site_tournament_matches_status_check
  check (status in ('pending', 'ready', 'pending_review', 'complete', 'bye', 'live'));

alter table public.rec_site_tournament_matches
  add column if not exists required_streamer_user_id uuid references public.rec_users(id),
  add column if not exists started_at timestamptz;

-- Backfill: the required streamer is player_a (the stable, populated-first slot) for every
-- existing match that already has both players seated.
update public.rec_site_tournament_matches
set required_streamer_user_id = player_a_user_id
where player_a_user_id is not null and required_streamer_user_id is null;

alter table public.rec_site_tournament_match_scheduling
  drop constraint rec_site_tournament_match_scheduling_status_check;
alter table public.rec_site_tournament_match_scheduling
  add constraint rec_site_tournament_match_scheduling_status_check
  check (status in ('not_scheduled', 'proposed', 'confirmed', 'reschedule_requested', 'live', 'completed', 'needs_admin_help'));

alter table public.rec_site_tournament_match_scheduling
  add column if not exists game_started_at timestamptz,
  add column if not exists game_completed_at timestamptz,
  add column if not exists window_opens_at timestamptz,
  add column if not exists window_closes_at timestamptz;

create table if not exists public.rec_site_tournament_match_checkins (
  match_id uuid not null references public.rec_site_tournament_matches(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  checked_in_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
alter table public.rec_site_tournament_match_checkins enable row level security;
