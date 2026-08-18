-- Tracks the single persistent announcements-channel post per confirmed H2H game (countdown to
-- kickoff, then live stream links, then final score) so it can be edited in place rather than
-- reposted -- one column pair is enough since a game has at most one announcement.
alter table public.rec_game_scheduling add column if not exists announcement_channel_id text;
alter table public.rec_game_scheduling add column if not exists announcement_message_id text;
