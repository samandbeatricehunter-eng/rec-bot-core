-- Active RTI tweet conversations (max 4 per league). Rows are deleted when a thread
-- hits max_turns so tracking does not accumulate after the exchange ends.
create table if not exists public.rec_immortality_tweet_conversations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  participant_handles text[] not null default '{}',
  last_author_handle text not null,
  last_target_handle text not null,
  last_body text not null,
  used_keys text[] not null default '{}',
  turn_count integer not null default 1,
  max_turns integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_immortality_tweet_conversations enable row level security;

create index if not exists rec_immortality_tweet_conversations_league_idx
  on public.rec_immortality_tweet_conversations (league_id, updated_at desc);
