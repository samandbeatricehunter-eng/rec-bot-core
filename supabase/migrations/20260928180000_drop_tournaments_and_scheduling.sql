-- Phase 1 removal: Tournaments feature + game-scheduling system fully removed from app code
-- (apps/api, apps/bot, apps/site, apps/web) per explicit user instruction. All 28 tables below
-- are exclusive to one of those two features; confirmed via information_schema that no table
-- outside this list holds a foreign key into any of them, so they can be dropped independently
-- of the rest of the schema. rec_user_suspensions (general moderation, still used by
-- users/user-moderation.service.ts and gotw-nomination.service.ts) is intentionally NOT in this
-- list and stays untouched.

-- Tournaments feature (17 tables)
drop table if exists public.rec_site_tournament_discord_posts;
drop table if exists public.rec_site_tournament_match_checkins;
drop table if exists public.rec_site_tournament_match_time_proposals;
drop table if exists public.rec_site_tournament_match_scheduling;
drop table if exists public.rec_site_tournament_round_schedules;
drop table if exists public.rec_site_tournament_lottery_skips;
drop table if exists public.rec_site_tournament_lotteries;
drop table if exists public.rec_site_tournament_wager_legs;
drop table if exists public.rec_site_tournament_wagers;
drop table if exists public.rec_site_tournament_highlights;
drop table if exists public.rec_site_tournament_matches;
drop table if exists public.rec_site_tournament_entrants;
drop table if exists public.rec_site_tournaments;
drop table if exists public.rec_site_roster_library_ea_pending_auth;
drop table if exists public.rec_site_roster_library_ea_connections;
drop table if exists public.rec_site_roster_library_players;
drop table if exists public.rec_site_roster_libraries;

-- Game-scheduling system (11 tables)
drop table if exists public.rec_scheduling_reminders_sent;
drop table if exists public.rec_weekly_confirmed_announcements;
drop table if exists public.rec_matchups_channel_posts;
drop table if exists public.rec_game_time_proposals;
drop table if exists public.rec_game_scheduling_events;
drop table if exists public.rec_game_scheduling;
drop table if exists public.rec_availability_overrides;
drop table if exists public.rec_user_availability_day_marks;
drop table if exists public.rec_user_availability_windows;
drop table if exists public.rec_user_availability_profiles;
drop table if exists public.rec_autopilot_grants;

-- Orphaned columns: tournament league-post channel config on the shared site Discord config
-- singleton table. Zero code references anywhere in the repo (never wired into
-- tournament-discord.service.ts's actual announcement logic before that module was deleted).
alter table public.rec_site_discord_config drop column if exists tournament_channel_madden;
alter table public.rec_site_discord_config drop column if exists tournament_channel_cfb;
