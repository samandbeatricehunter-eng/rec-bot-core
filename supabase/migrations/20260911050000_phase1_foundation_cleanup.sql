-- Master Handoff Plan, Phase 1 (Foundation cleanup).
-- Active league-management functionality is Madden-only: CFP/Heisman are removed.
-- The REC Rules channel/public-post path is removed; /rules is ephemeral-only.

drop table if exists public.rec_heisman_race_state;
drop table if exists public.rec_heisman_candidates;

alter table public.rec_server_routes
  drop column if exists rules_channel_id;
