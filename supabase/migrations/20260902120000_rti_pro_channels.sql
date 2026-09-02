-- Rise to Immortality: player card channels (offensive-pros / defensive-pros, populated when a
-- user finishes both prospects and picks a franchise), HOF milestones, and the weekly Pro
-- Tracker recap channel.
alter table public.rec_server_routes
  add column if not exists offensive_pros_channel_id text,
  add column if not exists defensive_pros_channel_id text,
  add column if not exists hof_milestones_channel_id text,
  add column if not exists pro_tracker_channel_id text;
