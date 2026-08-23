-- Tracks the one tournament-announcement embed posted per Discord server, so it can be edited
-- in place as participants/status/schedule change instead of reposting (same idiom as
-- rec_matchups_channel_posts).
create table if not exists public.rec_site_tournament_discord_posts (
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  guild_id text not null,
  channel_id text not null,
  message_id text not null,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, guild_id)
);
alter table public.rec_site_tournament_discord_posts enable row level security;
