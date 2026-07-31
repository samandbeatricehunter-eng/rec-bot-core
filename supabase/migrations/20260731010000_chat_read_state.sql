-- Unified read-state/unread tracking for the Universal Chat Drawer, spanning league chat,
-- game chat, and commissioner chat. channel_id is text (not uuid) because commissioner chat is
-- keyed by guild_id (text) while league/game channels are keyed by uuid — one column
-- accommodates both without a polymorphic-id workaround.
create table public.rec_chat_read_state (
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  channel_type text not null check (channel_type in ('league', 'game', 'commissioner')),
  channel_id text not null,
  last_read_message_id uuid,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  notification_level text not null default 'all' check (notification_level in ('all', 'mentions', 'none')),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_type, channel_id)
);

alter table public.rec_chat_read_state enable row level security;

create index rec_chat_read_state_user_league_idx
  on public.rec_chat_read_state (user_id, league_id);

-- Bring commissioner chat's row shape in line with league/game chat (source + Discord bridge
-- mapping columns), so the unified ChatMessageRow type doesn't need to special-case it. No
-- existing bridge writes these yet — purely additive, defaulted/nullable, no backfill needed.
alter table public.rec_commissioner_chat_messages
  add column if not exists source text not null default 'site' check (source in ('site', 'discord', 'system')),
  add column if not exists discord_message_id text,
  add column if not exists is_discord_only boolean not null default false;

create unique index if not exists rec_commissioner_chat_messages_discord_message_id_key
  on public.rec_commissioner_chat_messages (discord_message_id) where discord_message_id is not null;
