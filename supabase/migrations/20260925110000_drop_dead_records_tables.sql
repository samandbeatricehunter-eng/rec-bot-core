-- APPLIED 2026-08-25 (via Supabase MCP, after explicit user approval).
--
-- All five tables confirmed to have zero live application code references (grepped apps/ and
-- packages/ for each table/Drizzle-export name -- only schema.ts declarations found, since
-- removed in the same commit as this migration). rec_global_h2h_matchups (NOT touched) is the
-- live head-to-head history table, read by getH2hHistory() in official-records.service.ts.
--
-- rec_user_h2h_global_records held 29 stale rows -- this is the exact table the
-- Kayo4L/MrSixOnTheSticks points_for/points_against=0 bug (from the 2026-08 combined
-- data-integrity audit) was reported against. It's confirmed dead now (superseded by
-- rec_global_h2h_matchups), so those rows are leftovers from an abandoned feature, not
-- something worth fixing in place.
--
-- rec_players_baseline_dup_backup_20260815 held 3,121 rows, as expected for a named/dated
-- backup table. rec_user_h2h_league_records, rec_user_head_to_head_records, and
-- rec_user_records were all empty.
drop table if exists rec_user_h2h_league_records;
drop table if exists rec_user_head_to_head_records;
drop table if exists rec_user_records;
drop table if exists rec_user_h2h_global_records;
drop table if exists rec_players_baseline_dup_backup_20260815;
