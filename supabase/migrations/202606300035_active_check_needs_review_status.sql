-- Allow restart recovery to stop retrying active-check polls that Discord can no longer fetch.
-- No new public tables are created.

alter table public.rec_active_check_events
  drop constraint if exists rec_active_check_events_status_check;

alter table public.rec_active_check_events
  add constraint rec_active_check_events_status_check
  check (status in ('open', 'settled', 'cancelled', 'needs_review'));
