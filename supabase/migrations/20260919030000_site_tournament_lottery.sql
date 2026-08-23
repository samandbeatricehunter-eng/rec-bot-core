create table if not exists public.rec_site_tournament_lotteries (
  tournament_id uuid primary key references public.rec_site_tournaments(id) on delete cascade,
  status text not null default 'not_scheduled'
    check (status in ('not_scheduled','scheduled','drawing','picking','open_pool','completed')),
  scheduled_at timestamptz,
  notified_30min_at timestamptz,
  notified_10min_at timestamptz,
  notified_1min_at timestamptz,
  draw_order uuid[],
  current_position integer,
  current_pick_deadline_at timestamptz,
  open_pool_started_at timestamptz,
  open_pool_deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_site_tournament_lotteries enable row level security;

create table if not exists public.rec_site_tournament_lottery_skips (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  skipped_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (tournament_id, user_id)
);
alter table public.rec_site_tournament_lottery_skips enable row level security;
