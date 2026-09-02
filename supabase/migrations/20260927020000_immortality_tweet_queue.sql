-- Rise to Immortality "tweets" feed: up to 10 candidate posts generated per Advance (regular
-- season/postseason only), drained one at a time on a 4-hour cadence. A new Advance always
-- clears whatever is still pending from the previous one before queuing a fresh batch.
create table if not exists public.rec_immortality_tweet_queue (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  author_kind text not null check (author_kind in ('host', 'generic')),
  author_handle text not null,
  author_display_name text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'posted', 'cleared')),
  created_at timestamptz not null default now(),
  posted_at timestamptz
);
alter table public.rec_immortality_tweet_queue enable row level security;

create index if not exists rec_immortality_tweet_queue_pending_idx
  on public.rec_immortality_tweet_queue (league_id, status, created_at)
  where status = 'pending';
