-- REC Guide feature was removed entirely (app code no longer publishes or reads it).
-- Drop the now-orphaned column and table.

drop table if exists public.rec_guide_messages;

alter table public.rec_server_routes
  drop column if exists rec_guide_channel_id;
