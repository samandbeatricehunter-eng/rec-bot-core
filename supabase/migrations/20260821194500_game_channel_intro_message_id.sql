alter table public.rec_game_channels
  add column if not exists intro_message_id text;
