-- Linked streaming accounts (Twitch / YouTube / TikTok) plus the go-live confirm +
-- delayed autopost flow. Rec_stream_compliance_logs already records posted streams;
-- these tables track platform identity, live sessions, and the confirm/ignore prompt.

-- A user may post more than one stream in a week (re-share, opponent stream, a later
-- platform). The original unique(league, season, week, user) blocked that — drop it if
-- it is still present so autopost can record a new log when a linked account goes live.
alter table public.rec_stream_compliance_logs
  drop constraint if exists rec_stream_compliance_logs_league_id_season_number_week_number_user_id_key;

create table if not exists public.rec_streaming_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  platform text not null,
  platform_user_id text,
  platform_login text not null,
  display_name text,
  profile_url text,
  token_ciphertext text,
  token_iv text,
  token_tag text,
  token_expires_at timestamptz,
  eventsub_online_id text,
  eventsub_offline_id text,
  status text not null default 'active',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_streaming_accounts_platform_valid check (platform in ('twitch', 'youtube', 'tiktok')),
  constraint rec_streaming_accounts_status_valid check (status in ('active', 'needs_reauth', 'disabled')),
  unique (user_id, platform)
);

alter table public.rec_streaming_accounts enable row level security;

create unique index if not exists rec_streaming_accounts_platform_user_idx
  on public.rec_streaming_accounts (platform, platform_user_id)
  where platform_user_id is not null;

create index if not exists rec_streaming_accounts_user_idx
  on public.rec_streaming_accounts (user_id);

create table if not exists public.rec_streaming_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  account_id uuid not null references public.rec_streaming_accounts(id) on delete cascade,
  platform text not null,
  platform_stream_id text,
  stream_url text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'live',
  confirmed_game_id uuid references public.rec_games(id) on delete set null,
  ignored boolean not null default false,
  autopost_at timestamptz,
  posted_at timestamptz,
  posted_stream_log_id uuid references public.rec_stream_compliance_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_streaming_sessions_status_valid check (status in ('live', 'posted', 'ignored', 'ended'))
);

alter table public.rec_streaming_sessions enable row level security;

create index if not exists rec_streaming_sessions_open_idx
  on public.rec_streaming_sessions (user_id, platform)
  where ended_at is null;

create index if not exists rec_streaming_sessions_autopost_idx
  on public.rec_streaming_sessions (autopost_at)
  where posted_at is null and ignored = false and ended_at is null;

create table if not exists public.rec_streaming_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  prompt_kind text not null,
  prompt_date date not null default (timezone('utc', now()))::date,
  session_id uuid references public.rec_streaming_sessions(id) on delete set null,
  selected_game_id uuid references public.rec_games(id) on delete set null,
  confirmed_game_id uuid references public.rec_games(id) on delete set null,
  status text not null default 'pending',
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint rec_streaming_prompts_kind_valid check (prompt_kind in ('day_of', 'went_live')),
  constraint rec_streaming_prompts_status_valid check (status in ('pending', 'confirmed', 'declined'))
);

alter table public.rec_streaming_prompts enable row level security;

create unique index if not exists rec_streaming_prompts_day_of_idx
  on public.rec_streaming_prompts (user_id, prompt_date)
  where prompt_kind = 'day_of';

create index if not exists rec_streaming_prompts_session_idx
  on public.rec_streaming_prompts (session_id)
  where session_id is not null;

create table if not exists public.rec_streaming_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  source text not null default 'discord_dm',
  status text not null default 'armed',
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint rec_streaming_intents_status_valid check (status in ('armed', 'consumed', 'cancelled')),
  constraint rec_streaming_intents_source_valid check (source in ('discord_dm', 'site_modal', 'site_share'))
);

alter table public.rec_streaming_intents enable row level security;

create unique index if not exists rec_streaming_intents_armed_idx
  on public.rec_streaming_intents (user_id, game_id)
  where status = 'armed';
