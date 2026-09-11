-- Covering indexes for FK columns the Phase 0/1c social-engine code actually filters on (flagged
-- by the Supabase performance advisor after adding rec_media_storylines.player_id): findOpenStoryline
-- (media-storylines.service.ts) queries by team_id/user_id/player_id, and
-- recentRecordBreakBonusScore (nfl-record-holders.service.ts) queries rec_media_events by player_id.
create index if not exists rec_media_storylines_team_idx on public.rec_media_storylines (league_id, storyline_type, team_id);
create index if not exists rec_media_storylines_user_idx on public.rec_media_storylines (league_id, storyline_type, user_id);
create index if not exists rec_media_events_player_idx on public.rec_media_events (player_id, event_type, created_at desc);
