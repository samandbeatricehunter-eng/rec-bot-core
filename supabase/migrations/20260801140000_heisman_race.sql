-- In-season Heisman Race tracker (CFB only): up to 4 candidates a commissioner watches
-- through the season, distinct from the end-of-season Heisman Trophy award vote
-- (rec_eos_award_polls' mvp category) — this is a running watch list, not a ballot.
create table if not exists public.rec_heisman_candidates (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  player_name text not null check (length(trim(player_name)) > 0),
  team_id uuid references public.rec_teams(id) on delete set null,
  added_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_heisman_candidates enable row level security;
create index if not exists rec_heisman_candidates_league_season_idx
  on public.rec_heisman_candidates(league_id, season_number);
