create table if not exists public.rec_commissioners_inbox (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  server_id uuid references public.rec_discord_servers(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  season_number integer,
  week_number integer,
  queue_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'cancelled', 'expired', 'resolved')),
  priority integer not null default 0,
  header text not null,
  summary text,
  requester_user_id uuid references public.rec_users(id) on delete set null,
  requester_discord_id text,
  target_user_id uuid references public.rec_users(id) on delete set null,
  target_discord_id text,
  team_id uuid references public.rec_teams(id) on delete set null,
  amount numeric,
  source_table text,
  source_id uuid,
  source_reference jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  review_channel_id text,
  review_message_id text,
  reviewed_by_user_id uuid references public.rec_users(id) on delete set null,
  reviewed_by_discord_id text,
  reviewed_at timestamptz,
  review_reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_commissioners_inbox enable row level security;

create index if not exists rec_commissioners_inbox_guild_status_idx
  on public.rec_commissioners_inbox(guild_id, status, priority desc, created_at desc);

create index if not exists rec_commissioners_inbox_league_status_idx
  on public.rec_commissioners_inbox(league_id, status, priority desc, created_at desc);

create index if not exists rec_commissioners_inbox_queue_type_idx
  on public.rec_commissioners_inbox(guild_id, queue_type, status, created_at desc);

create unique index if not exists rec_commissioners_inbox_source_unique_idx
  on public.rec_commissioners_inbox(guild_id, queue_type, source_table, source_id)
  where source_table is not null and source_id is not null;
