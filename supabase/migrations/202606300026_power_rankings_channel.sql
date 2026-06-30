-- Dedicated Discord route for weekly power rankings posts.
-- rec_server_routes already has RLS enabled; no new table is created here.
alter table public.rec_server_routes
  add column if not exists power_rankings_channel_id text;
