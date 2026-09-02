-- Tracks the real-world NFL all-time record book per RTI league, seeded from the frozen
-- packages/shared/src/immortality/nfl-records.ts dataset. current_holder_name/current_value
-- start out as the real NFL record and move to an in-league player once someone's career total
-- (see league-stats scope=career leaders) actually passes it -- see
-- apps/api/src/modules/immortality/nfl-record-holders.service.ts.
create table if not exists public.rec_immortality_nfl_records (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  category text not null,
  label text not null,
  current_holder_name text not null,
  current_value numeric not null,
  is_broken boolean not null default false,
  broken_by_player_id uuid references public.rec_players(id) on delete set null,
  broken_by_user_id uuid references public.rec_users(id) on delete set null,
  broken_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immortality_league_id, category)
);
alter table public.rec_immortality_nfl_records enable row level security;

create index if not exists rec_immortality_nfl_records_league_idx
  on public.rec_immortality_nfl_records (immortality_league_id);
