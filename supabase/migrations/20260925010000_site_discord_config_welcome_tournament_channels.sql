alter table public.rec_site_discord_config
  add column if not exists welcome_channel_id text,
  add column if not exists tournament_channel_madden text,
  add column if not exists tournament_channel_cfb text;
