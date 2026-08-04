-- headlines_channel_id and voting_polls_channel_id were referenced by app code and by
-- older drafted migrations (202606300022_headlines_channel_and_legacy_badge_cleanup.sql,
-- 202606100012_voting_polls_channel.sql) that were apparently never actually applied to
-- the remote project — the columns didn't exist in production. Adding them here directly
-- rather than running those older files, since one of them also rewrote rec_delete_league,
-- which is unrelated and shouldn't ride along with this fix.

alter table public.rec_server_routes
  add column if not exists headlines_channel_id text;

alter table public.rec_server_routes
  add column if not exists voting_polls_channel_id text;
