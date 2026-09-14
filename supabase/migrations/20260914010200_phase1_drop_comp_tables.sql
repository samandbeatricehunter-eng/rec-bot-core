-- Phase 1 cleanup: the Comp (H2H matchmaking) product is fully removed. Its API module, site
-- routes/client, and cross-domain leaks (tournaments' gamer-tag lookup, power-rankings comp
-- scope in both TS and the refresh_power_rankings() pg_cron function) were migrated off these
-- tables first. No external foreign keys reference rec_comp_% (verified via
-- information_schema.table_constraints before this migration).
drop table if exists public.rec_comp_admin_cases cascade;
drop table if exists public.rec_comp_user_season_flags cascade;
drop table if exists public.rec_comp_reports cascade;
drop table if exists public.rec_comp_box_score_submissions cascade;
drop table if exists public.rec_comp_stream_shares cascade;
drop table if exists public.rec_comp_messages cascade;
drop table if exists public.rec_comp_matches cascade;
drop table if exists public.rec_comp_queue_entries cascade;
drop table if exists public.rec_comp_game_stats cascade;
drop table if exists public.rec_comp_seasons cascade;
drop table if exists public.rec_comp_profiles cascade;
