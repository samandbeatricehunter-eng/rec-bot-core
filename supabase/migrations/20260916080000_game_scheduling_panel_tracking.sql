-- Tracks the persistent game-channel scheduling panel message so it can be refreshed in place
-- (live status + suggested overlap) whenever either coach's availability changes, instead of
-- staying static from the moment it's first posted.
alter table public.rec_game_scheduling add column if not exists panel_channel_id text;
alter table public.rec_game_scheduling add column if not exists panel_message_id text;
