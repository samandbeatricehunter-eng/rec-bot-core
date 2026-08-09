alter table public.rec_fantasy_draft_sessions
  add column if not exists on_clock_message_channel_id text,
  add column if not exists on_clock_message_id text;
