-- Emoji reactions on chat messages (spec §9.5), spanning all three chat tables from Phase 1
-- (league/game/commissioner). channel_type + message_id together identify the message, same
-- discriminator pattern as rec_chat_read_state. discord_id (not user_id) is the uniqueness key
-- since it's always populated for any chat author, including Discord-only (unlinked) accounts,
-- unlike user_id which can be null for them.
create table public.rec_chat_reactions (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('league', 'game', 'commissioner')),
  message_id uuid not null,
  user_id uuid references public.rec_users(id) on delete cascade,
  discord_id text not null,
  emoji_key text not null,
  source text not null default 'site' check (source in ('site', 'discord')),
  created_at timestamptz not null default now(),
  unique (channel_type, message_id, discord_id, emoji_key)
);

alter table public.rec_chat_reactions enable row level security;

create index rec_chat_reactions_message_idx
  on public.rec_chat_reactions (channel_type, message_id);
