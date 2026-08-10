-- Singleton site-wide Discord configuration, editable from the admin console:
--   management_guild_id       the Discord server used to manage the site/bot itself — the
--                             only guild the bot is allowed to sit in without being linked to
--                             an active league (see the bot's daily unlinked-guild sweep).
--   league_post_channel_*     per-game-type recruiting-board channel id, where the bot posts
--                             a live "open teams" ad for each newly created league of that
--                             game type.
create table if not exists public.rec_site_discord_config (
  id boolean primary key default true,
  management_guild_id text,
  league_post_channel_madden_26 text,
  league_post_channel_madden_27 text,
  league_post_channel_cfb_27 text,
  updated_at timestamptz not null default now(),
  constraint rec_site_discord_config_singleton check (id)
);

alter table public.rec_site_discord_config enable row level security;

insert into public.rec_site_discord_config (id, management_guild_id)
values (true, '1536368873870336071')
on conflict (id) do update set management_guild_id = excluded.management_guild_id;
