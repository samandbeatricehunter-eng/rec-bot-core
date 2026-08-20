create table if not exists public.rec_user_suspensions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id),
  user_id uuid not null references public.rec_users(id),
  reason text not null,
  weeks integer not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by_user_id uuid references public.rec_users(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.rec_user_suspensions enable row level security;

create index if not exists rec_user_suspensions_user_active_idx on public.rec_user_suspensions(user_id, active);
create index if not exists rec_user_suspensions_league_idx on public.rec_user_suspensions(league_id);
