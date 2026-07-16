-- "This Defense Needs a Name" EOS payout category: the first time a team qualifies,
-- the coach names their defense; the nickname persists across seasons as long as they
-- keep requalifying, and is retired (not deleted) the first season they don't, so it
-- can come back if they earn it again later (fresh name choice at that point).
create table if not exists public.rec_team_defense_nicknames (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  nickname text,
  first_earned_season integer not null,
  last_qualified_season integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, team_id)
);

alter table public.rec_team_defense_nicknames enable row level security;
