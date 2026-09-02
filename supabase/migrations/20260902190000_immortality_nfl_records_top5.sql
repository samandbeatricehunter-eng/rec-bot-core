-- Redesign from a single #1-holder row per category to a top-5 leaderboard per category, per
-- the actual product spec: users can displace ranks 2-5 automatically as their career totals
-- climb, but only unseating rank 1 (a genuinely broken record) posts + tags the breaker.
-- Table is empty in production (feature just shipped, no league has imported since) so a clean
-- drop/recreate is safe -- no data migration needed.
drop table if exists public.rec_immortality_nfl_records;

create table public.rec_immortality_nfl_records (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  category text not null,
  label text not null,
  rank smallint not null check (rank between 1 and 5),
  holder_name text not null,
  value numeric not null,
  is_league_player boolean not null default false,
  player_id uuid references public.rec_players(id) on delete set null,
  user_id uuid references public.rec_users(id) on delete set null,
  set_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immortality_league_id, category, rank)
);
alter table public.rec_immortality_nfl_records enable row level security;

create index if not exists rec_immortality_nfl_records_league_idx
  on public.rec_immortality_nfl_records (immortality_league_id);
