-- Madden EA-import wipe/reconcile paths (ea-connections.service.ts) already write
-- roster_status='removed' for players no longer in an EA export, but 'removed' was never
-- added to the check constraint — CFB's dynasty-specific values (drafted/transferred_out/
-- transferred_in/retired/graduated) don't apply to Madden, which just needs active vs. removed.
alter table public.rec_players drop constraint rec_players_roster_status_check;
alter table public.rec_players add constraint rec_players_roster_status_check
  check (roster_status = any (array['active','drafted','transferred_out','transferred_in','retired','graduated','removed']));
