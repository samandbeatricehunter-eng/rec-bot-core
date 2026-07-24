-- League-wide chat + per-matchup "game chat" (bridged bidirectionally to the paired Discord
-- game channel) + a poll-based presence heartbeat for the "Online"/"Offline" roster in the new
-- Campus Buzz "Chat" tab. Poll-based like every other chat feature in this codebase
-- (commissioner chat, matchup chat) — no realtime infra.

create table public.rec_league_chat_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  author_user_id uuid references public.rec_users(id) on delete set null,
  author_discord_id text,
  author_display_name text not null,
  is_discord_only boolean not null default false,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.rec_league_chat_messages enable row level security;

create index rec_league_chat_messages_league_created_idx
  on public.rec_league_chat_messages (league_id, created_at);

-- One row set per rec_game_channels row — deleted when that channel is torn down (weekly
-- rotation), independent of rec_matchup_chat_messages' league-wide wipe-on-every-advance
-- lifecycle. source distinguishes site-authored, Discord-authored (bridged), and system
-- (channel-opened intro card) rows; discord_message_id makes a retried bot ingest a no-op.
create table public.rec_game_chat_messages (
  id uuid primary key default gen_random_uuid(),
  game_channel_id uuid not null references public.rec_game_channels(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  game_id uuid references public.rec_games(id) on delete set null,
  author_user_id uuid references public.rec_users(id) on delete set null,
  author_discord_id text,
  author_display_name text not null,
  is_discord_only boolean not null default false,
  source text not null default 'site' check (source in ('site', 'discord', 'system')),
  discord_message_id text,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.rec_game_chat_messages enable row level security;

create index rec_game_chat_messages_channel_created_idx
  on public.rec_game_chat_messages (game_channel_id, created_at);

create unique index rec_game_chat_messages_discord_message_id_key
  on public.rec_game_chat_messages (discord_message_id) where discord_message_id is not null;

-- Client upserts every ~25s while the Chat tab is mounted; "online" = last_seen_at within the
-- last ~60s, computed at read time (same lazy-computation idiom as commissioner chat's
-- purgeOldMessages) rather than via a cron job.
create table public.rec_hub_presence_heartbeats (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  discord_id text,
  last_seen_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.rec_hub_presence_heartbeats enable row level security;
