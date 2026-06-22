-- Box Scores channel route: the dedicated channel the bot watches for box score
-- screenshot uploads. rec_server_routes already has RLS enabled.
alter table public.rec_server_routes
  add column if not exists box_scores_channel_id text;
