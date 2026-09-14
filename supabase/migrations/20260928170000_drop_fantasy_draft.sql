-- Drop fantasy/annual draft tables and league status column.
-- Child tables first (IF EXISTS for safety after earlier simplify migrations).

-- Existing fantasy-draft leagues become regular rosters (mechanics removed).
update public.rec_league_configuration
set roster_type = 'regular_rosters'
where roster_type = 'fantasy_draft';

update public.rec_leagues
set league_type = 'regular_rosters'
where league_type = 'fantasy_draft';

drop table if exists public.rec_fantasy_draft_skipped_picks cascade;
drop table if exists public.rec_fantasy_draft_board_entries cascade;
drop table if exists public.rec_fantasy_draft_pick_requests cascade;
drop table if exists public.rec_fantasy_draft_saved_board_entries cascade;
drop table if exists public.rec_fantasy_draft_saved_boards cascade;
drop table if exists public.rec_fantasy_draft_checkins cascade;
drop table if exists public.rec_fantasy_draft_picks cascade;
drop table if exists public.rec_fantasy_draft_pick_order cascade;
drop table if exists public.rec_fantasy_draft_sessions cascade;

drop function if exists private.rec_remove_drafted_from_boards();
drop function if exists public.rec_remove_drafted_from_boards();

alter table public.rec_leagues drop column if exists fantasy_draft_status;
