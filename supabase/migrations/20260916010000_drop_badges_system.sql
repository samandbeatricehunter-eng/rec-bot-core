-- Badges removed app-wide: the tables, the per-game/season/career logging, and the
-- coin payouts tied to them are all gone from application code as of this pass. Drop
-- the now-unused storage. No FKs reference these tables (verified via pg_constraint
-- before this migration was written).
drop table if exists rec_badge_events;
drop table if exists rec_badge_ownership;
drop table if exists rec_badge_catalog;

alter table rec_game_profiles drop column if exists qualified_badges;
alter table rec_advance_dm_runs drop column if exists badge_state;
