-- Drop the dead EA-import-era snapshot/team-stats tables and the rec_roster_team RPC that
-- still read them.
--
-- rec_roster_snapshots was truncated when the EA import infrastructure was removed
-- (20260624010000_remove_ea_import_infrastructure.sql) and has no writers; live roster data
-- lives on rec_players (team_id / roster_status / attributes).
-- rec_team_weekly_stats has no writers or readers anywhere in the codebase.
-- rec_roster_team(text, uuid) is the only RPC that read the snapshot table; no code calls it.
--
-- rec_roster_league_conferences is intentionally kept: it reads only rec_teams and
-- rec_team_assignments and is live-called by the API
-- (apps/api/src/modules/league-conferences/league-conferences.service.ts).
--
-- The dynamic rec_delete_league (20260731140000_harden_rec_delete_league.sql) discovers
-- league tables via pg_class, so dropping these tables needs no function update.

drop function if exists public.rec_roster_team(text, uuid);

drop table if exists public.rec_roster_snapshots;
drop table if exists public.rec_team_weekly_stats;
