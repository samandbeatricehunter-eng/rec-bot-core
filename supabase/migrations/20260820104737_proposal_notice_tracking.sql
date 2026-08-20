alter table public.rec_game_time_proposals
  add column if not exists notice_channel_id text,
  add column if not exists notice_message_id text;
