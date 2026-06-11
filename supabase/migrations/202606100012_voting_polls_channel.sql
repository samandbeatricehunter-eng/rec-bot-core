alter table public.rec_server_routes
  add column if not exists voting_polls_channel_id text;
