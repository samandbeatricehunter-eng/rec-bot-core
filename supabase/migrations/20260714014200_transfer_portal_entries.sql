create table if not exists public.rec_transfer_portal_entries (
  id uuid primary key,
  league_id uuid not null references public.rec_leagues(id),
  season_number integer not null,
  player_name text not null,
  position text not null,
  class_year text check (class_year in ('freshman', 'sophomore', 'junior', 'senior') or class_year is null),
  origin_team_id uuid not null references public.rec_teams(id),
  status text not null default 'entered_portal' check (status in ('entered_portal', 'transferred', 'withdrawn')),
  destination_team_id uuid references public.rec_teams(id),
  destination_team_external text,
  entry_date date,
  story_id uuid references public.rec_game_stories(id),
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_transfer_portal_entries enable row level security;
create index if not exists rec_transfer_portal_entries_league_idx on public.rec_transfer_portal_entries(league_id, status);
