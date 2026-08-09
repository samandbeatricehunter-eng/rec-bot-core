create table if not exists public.rec_trade_block_listings (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  discord_id text,
  offered_legs jsonb not null default '[]'::jsonb,
  offered_coins integer not null default 0,
  looking_for text not null,
  status text not null default 'open' check (status in ('open', 'withdrawn', 'completed')),
  discord_message_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_trade_block_listings enable row level security;

create index if not exists rec_trade_block_listings_league_status_idx
  on public.rec_trade_block_listings (league_id, status);
