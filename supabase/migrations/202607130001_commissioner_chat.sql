-- Commissioner chat + voting — replaces the need for the Commissioner's Office Discord
-- channel with an in-app space for commissioners/co-commissioners to discuss and vote on
-- topics. Simple polling read model (no realtime infra) given the tiny audience per league.

create table if not exists public.rec_commissioner_chat_messages (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  author_user_id uuid references public.rec_users(id) on delete set null,
  author_discord_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.rec_commissioner_chat_messages enable row level security;

create index if not exists rec_commissioner_chat_messages_guild_created_idx
  on public.rec_commissioner_chat_messages (guild_id, created_at);

create table if not exists public.rec_commissioner_chat_topics (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  created_by_user_id uuid references public.rec_users(id) on delete set null,
  created_by_discord_id text not null,
  title text not null,
  description text,
  options jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'closed')),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_commissioner_chat_topics enable row level security;

create index if not exists rec_commissioner_chat_topics_guild_status_idx
  on public.rec_commissioner_chat_topics (guild_id, status, created_at desc);

create table if not exists public.rec_commissioner_chat_topic_votes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.rec_commissioner_chat_topics(id) on delete cascade,
  voter_user_id uuid references public.rec_users(id) on delete set null,
  voter_discord_id text not null,
  option_index integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_commissioner_chat_topic_votes enable row level security;

-- One vote per commissioner per topic — voting again updates the existing row (see
-- commissioner-chat.service.ts's upsert onConflict).
create unique index if not exists rec_commissioner_chat_topic_votes_topic_voter_idx
  on public.rec_commissioner_chat_topic_votes (topic_id, voter_discord_id);
