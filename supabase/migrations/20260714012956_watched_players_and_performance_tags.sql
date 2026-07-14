-- Persistent per-team "Players to Watch" list — added once via a commissioner-managed
-- roster, then reused as a dropdown source when tagging performances at score-entry time.
-- Soft-delete via is_active (not a hard delete) so historical performance tags that
-- reference a since-removed player still resolve correctly.
create table if not exists public.rec_watched_players (
  id uuid primary key,
  league_id uuid not null references public.rec_leagues(id),
  team_id uuid not null references public.rec_teams(id),
  player_name text not null,
  position text not null,
  class_year text check (class_year in ('freshman', 'sophomore', 'junior', 'senior') or class_year is null),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_watched_players enable row level security;
create index if not exists rec_watched_players_team_idx on public.rec_watched_players(team_id, is_active);

-- Per-game performance tags entered alongside a manual score — either for an individual
-- watched player (subject_type = 'player') or a whole unit (subject_type = 'unit').
-- Feeds the headline/story generator with specific, sourced performance notes.
create table if not exists public.rec_game_performance_tags (
  id uuid primary key,
  league_id uuid not null references public.rec_leagues(id),
  game_id uuid not null references public.rec_games(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  team_id uuid not null references public.rec_teams(id),
  subject_type text not null check (subject_type in ('player', 'unit')),
  watched_player_id uuid references public.rec_watched_players(id),
  unit text check (unit in ('offense', 'defense', 'special_teams') or unit is null),
  stat_lines jsonb not null default '[]'::jsonb,
  performance_grade text not null check (performance_grade in ('standout', 'solid', 'neutral', 'poor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_game_performance_tags enable row level security;
create index if not exists rec_game_performance_tags_game_idx on public.rec_game_performance_tags(game_id);
create index if not exists rec_game_performance_tags_watched_player_idx on public.rec_game_performance_tags(watched_player_id);
