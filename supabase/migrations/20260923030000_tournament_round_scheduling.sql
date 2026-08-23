alter table public.rec_site_tournaments
  add column if not exists schedule_mode text not null default 'single_kickoff'
    check (schedule_mode in ('single_kickoff', 'per_round'));

alter table public.rec_site_tournament_matches
  add column if not exists scheduled_at timestamptz;

create table if not exists public.rec_site_tournament_round_schedules (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  bracket_side text not null check (bracket_side in ('winners', 'losers', 'grand_final')),
  round integer not null,
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, bracket_side, round)
);
alter table public.rec_site_tournament_round_schedules enable row level security;
