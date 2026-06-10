-- End-of-season award polls and votes.
-- Polls are created when regular season ends (regular_season → wild_card transition).
-- Locked when playoffs advance (wild_card → divisional) or after 24h, whichever comes first.

create table if not exists public.rec_eos_award_polls (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  category_key text not null,
  category_label text not null,
  category_description text,
  status text not null default 'open',
  winner_user_id uuid references public.rec_users(id),
  opened_at timestamptz not null default now(),
  closes_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, season_number, category_key)
);
alter table public.rec_eos_award_polls enable row level security;

-- One vote per coach per poll (upsert on conflict replaces previous vote)
create table if not exists public.rec_eos_award_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.rec_eos_award_polls(id) on delete cascade,
  voter_user_id uuid not null references public.rec_users(id),
  nominee_user_id uuid not null references public.rec_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(poll_id, voter_user_id)
);
alter table public.rec_eos_award_votes enable row level security;
