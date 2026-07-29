-- Daily-snapshot global power rankings, split by scope (dynasty/franchise league play vs future
-- H2H Comp matchmaking) and game (madden_26/madden_27/cfb_27 rank separately). One row per
-- (game, scope, user, computed_date); previous rank is read by looking up the most recent prior
-- computed_date row for that user, not stored redundantly.
create table if not exists public.rec_global_power_rankings (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  scope text not null check (scope in ('dynasty', 'comp')),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  rank integer not null,
  score numeric not null default 0,
  computed_date date not null,
  created_at timestamptz not null default now(),
  unique (game, scope, user_id, computed_date)
);
create index if not exists rec_global_power_rankings_lookup_idx
  on public.rec_global_power_rankings (game, scope, computed_date, rank);
create index if not exists rec_global_power_rankings_user_idx
  on public.rec_global_power_rankings (game, scope, user_id, computed_date desc);
alter table public.rec_global_power_rankings enable row level security;
