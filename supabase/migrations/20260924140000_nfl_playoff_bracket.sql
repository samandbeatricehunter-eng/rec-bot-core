-- Real NFL-style playoff bracket for Madden leagues: seed -> real playable rec_games rows,
-- tracked in a slot table exactly like rec_cfp_brackets/rec_cfp_bracket_slots (see
-- 20260730195109_launch_readiness_cfp_billing_controls.sql), but built for true dynamic
-- reseeding every round (lowest surviving seed vs highest surviving seed) instead of a static
-- bracket definition -- computeRoundMatchups() in nfl-bracket.service.ts is what CFP's
-- bracketDefinition() can't be, because real NFL playoffs reseed past round one.
create table if not exists public.rec_nfl_brackets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  status text not null default 'active' check (status in ('active','complete')),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number)
);
alter table public.rec_nfl_brackets enable row level security;

create table if not exists public.rec_nfl_bracket_slots (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid not null references public.rec_nfl_brackets(id) on delete cascade,
  conference text not null check (conference in ('AFC','NFC','SB')), -- 'SB' for the single Super Bowl slot
  round text not null check (round in ('wild_card','divisional','conference_championship','super_bowl')),
  slot_number integer not null check (slot_number > 0),
  home_seed integer check (home_seed between 1 and 7),
  away_seed integer check (away_seed between 1 and 7),
  home_team_id uuid references public.rec_teams(id) on delete restrict,
  away_team_id uuid references public.rec_teams(id) on delete restrict,
  game_id uuid references public.rec_games(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (bracket_id, conference, round, slot_number)
);
alter table public.rec_nfl_bracket_slots enable row level security;
create index if not exists rec_nfl_bracket_slots_game_idx on public.rec_nfl_bracket_slots(game_id) where game_id is not null;

revoke all on table public.rec_nfl_brackets from anon, authenticated;
revoke all on table public.rec_nfl_bracket_slots from anon, authenticated;

-- syncNflBracketRound() inserts rec_games rows with source='nfl_bracket' -- same fix the CFP
-- bracket needed (20260801130000_add_cfp_bracket_source_type.sql) before this value existed.
alter type public.rec_source_type add value if not exists 'nfl_bracket';
