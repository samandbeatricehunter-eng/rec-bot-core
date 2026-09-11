-- Phase 0 of the Media/Tweets/Challenges/Persona rebuild (see
-- C:\Users\josh_\.claude\plans\refactored-swimming-token.md and the uploaded
-- REC_Total_Master_Handoff package, apps/REC_Total_Master_Handoff.zip): the shared social/media
-- event-graph schema. Unified across RTI and non-RTI leagues -- rec_tweets/rec_tweet_queue_v2
-- supersede rec_immortality_tweet_queue as the conversation source of truth going forward (that
-- table is left in place for now; migrating its existing rows is a later step, not part of this
-- schema-only pass).

create table if not exists public.rec_media_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer,
  event_type text not null,
  team_id uuid references public.rec_teams(id) on delete set null,
  user_id uuid references public.rec_users(id) on delete set null,
  player_id uuid references public.rec_players(id) on delete set null,
  game_id uuid references public.rec_games(id) on delete set null,
  -- Loosely-typed cross-references (trade/rivalry/award), deliberately without FK constraints --
  -- this is an append-only event bus meant to record a pointer even if the source system's exact
  -- table shape changes later; facts_json carries the durable detail.
  trade_id uuid,
  rivalry_id uuid,
  award_id uuid,
  importance_score integer not null default 0,
  facts_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_media_events enable row level security;
create index if not exists rec_media_events_league_idx on public.rec_media_events (league_id, created_at desc);
create index if not exists rec_media_events_type_idx on public.rec_media_events (league_id, event_type);

create table if not exists public.rec_media_storylines (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete cascade,
  user_id uuid references public.rec_users(id) on delete cascade,
  storyline_type text not null,
  title text not null,
  premise_json jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'abandoned')),
  priority integer not null default 0,
  opened_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.rec_media_storylines enable row level security;
create index if not exists rec_media_storylines_league_idx on public.rec_media_storylines (league_id, status);

create table if not exists public.rec_tweets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  event_id uuid references public.rec_media_events(id) on delete set null,
  storyline_id uuid references public.rec_media_storylines(id) on delete set null,
  root_tweet_id uuid references public.rec_tweets(id) on delete cascade,
  parent_tweet_id uuid references public.rec_tweets(id) on delete cascade,
  author_key text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'posted', 'purged')),
  platform_channel_id text,
  platform_message_id text,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.rec_tweets enable row level security;
create index if not exists rec_tweets_league_idx on public.rec_tweets (league_id, created_at desc);
create index if not exists rec_tweets_root_idx on public.rec_tweets (root_tweet_id);
create index if not exists rec_tweets_parent_idx on public.rec_tweets (parent_tweet_id);

create table if not exists public.rec_tweet_queue_v2 (
  id uuid primary key default gen_random_uuid(),
  tweet_id uuid not null references public.rec_tweets(id) on delete cascade,
  ready_after timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  status text not null default 'pending' check (status in ('pending', 'posted', 'failed', 'cancelled')),
  created_at timestamptz not null default now()
);
alter table public.rec_tweet_queue_v2 enable row level security;
create index if not exists rec_tweet_queue_v2_pending_idx on public.rec_tweet_queue_v2 (ready_after) where status = 'pending';

-- Non-RTI's two user-selected rival slots (feeds story-arc eligibility for the social engine).
create table if not exists public.rec_team_rival_slots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  slot integer not null check (slot in (1, 2)),
  rival_team_id uuid not null references public.rec_teams(id) on delete cascade,
  unchanged_since_season integer not null,
  last_changed_season integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, user_id, slot)
);
alter table public.rec_team_rival_slots enable row level security;

-- Persistent per-account memory driving the social engine's repetition control (recent
-- subjects/stances/phrase fingerprints/open predictions/relationships) -- see
-- SOCIAL_SYSTEM_ARCHITECTURE.md's "Persistent account memory" section.
create table if not exists public.rec_account_memory (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  author_key text not null,
  memory_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (league_id, author_key)
);
alter table public.rec_account_memory enable row level security;
