-- Reply-to support (spec §9.1/§9.5) across all three chat tables. Self-referencing, nullable —
-- a message with no reply_to_message_id is just a normal top-level message, unchanged from
-- today. on delete set null so a deleted parent doesn't take its replies down with it.
alter table public.rec_league_chat_messages
  add column if not exists reply_to_message_id uuid references public.rec_league_chat_messages(id) on delete set null;

alter table public.rec_game_chat_messages
  add column if not exists reply_to_message_id uuid references public.rec_game_chat_messages(id) on delete set null;

alter table public.rec_commissioner_chat_messages
  add column if not exists reply_to_message_id uuid references public.rec_commissioner_chat_messages(id) on delete set null;
