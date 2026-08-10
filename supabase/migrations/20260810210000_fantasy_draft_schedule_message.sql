-- Track the Discord announcement embed posted when a fantasy draft is scheduled so
-- reschedules can edit the same message instead of spamming a new one each time.
alter table public.rec_fantasy_draft_sessions
  add column if not exists schedule_message_channel_id text,
  add column if not exists schedule_message_id text;