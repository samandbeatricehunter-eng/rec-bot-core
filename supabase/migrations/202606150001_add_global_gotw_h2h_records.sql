-- Per-user all-time head-to-head record in Game-of-the-Week games.
-- Populated during advance when a selected GOTW game (H2H) is settled.
create table if not exists public.rec_global_gotw_h2h_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  games_played integer not null default 0,
  last_result_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_global_gotw_h2h_records enable row level security;
