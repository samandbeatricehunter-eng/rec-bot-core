-- Superseded by rec_game_chat_messages, which is tied to rec_game_channels and
-- supports the bidirectional Discord/site bridge.
set local lock_timeout = '5s';
drop table if exists public.rec_matchup_chat_messages;
