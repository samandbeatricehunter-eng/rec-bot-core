create table if not exists public.rec_recruiting_profiles (
  id uuid primary key,
  league_id uuid not null references public.rec_leagues(id),
  season_number integer not null,
  player_name text not null,
  position text not null,
  home_city text,
  home_state text,
  star_rating integer not null check (star_rating between 1 and 5),
  status text not null default 'uncommitted' check (status in ('uncommitted', 'committed', 'decommitted')),
  committed_team_id uuid references public.rec_teams(id),
  committed_team_external text,
  commit_date date,
  story_id uuid references public.rec_game_stories(id),
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_recruiting_profiles enable row level security;
create index if not exists rec_recruiting_profiles_league_idx on public.rec_recruiting_profiles(league_id, status);
