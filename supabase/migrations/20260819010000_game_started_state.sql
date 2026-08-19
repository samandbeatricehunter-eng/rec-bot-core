-- Generalizes "stream started" into "game started" -- a coach can now mark a game live via a
-- manual button, not only by posting a stream link. Renaming the column keeps its long history
-- of "when did this game actually kick off" semantics intact while making its name accurate.
alter table public.rec_game_scheduling rename column stream_started_at to game_started_at;

alter table public.rec_game_scheduling drop constraint rec_game_scheduling_status_check;
alter table public.rec_game_scheduling add constraint rec_game_scheduling_status_check
  check (status in (
    'not_scheduled', 'proposed', 'confirmed', 'reschedule_requested',
    'no_shared_availability', 'needs_commissioner_help', 'live', 'completed'
  ));
