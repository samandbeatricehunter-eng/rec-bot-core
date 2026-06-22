-- Flat per-team-per-game stat table (two rows per game) for leaderboards and
-- defensive ratings. Offensive stats are the team's own; generated/allowed
-- stats are the opponent's offense mirrored. Written on box-score approval.
create table if not exists public.rec_team_game_stats (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  season_number integer not null,
  week_number integer not null,
  phase text,
  game_id uuid,
  submission_id uuid not null,
  team_id uuid,
  opponent_team_id uuid,
  user_id uuid,
  opponent_user_id uuid,
  is_home boolean,
  result text,
  points_for integer,
  points_against integer,
  off_yards_gained integer,
  off_rush_yards integer,
  off_pass_yards integer,
  off_first_down integer,
  punt_return_yards integer,
  kick_return_yards integer,
  total_yards_gained integer,
  turnovers_committed integer,
  red_zone_off_percentage integer,
  time_of_possession text,
  generated_turnovers integer,
  yards_allowed integer,
  rush_yards_allowed integer,
  pass_yards_allowed integer,
  first_downs_allowed integer,
  red_zone_def_percentage integer,
  comeback_deficit integer,
  comeback_deficit_quarter integer,
  comeback_rate numeric,
  fourth_quarter_comeback boolean default false,
  quarter_scores jsonb,
  offensive_stats jsonb,
  defensive_stats jsonb,
  created_at timestamptz not null default now(),
  unique (submission_id, team_id)
);
alter table public.rec_team_game_stats enable row level security;
create index if not exists idx_rec_team_game_stats_league_week on public.rec_team_game_stats (league_id, season_number, week_number);
create index if not exists idx_rec_team_game_stats_team on public.rec_team_game_stats (team_id);
create index if not exists idx_rec_team_game_stats_user on public.rec_team_game_stats (user_id);

-- Box-score verification: store OCR-orientation team ids + the flag result.
alter table public.rec_box_score_submissions
  add column if not exists team1_id uuid,
  add column if not exists team2_id uuid,
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_reasons jsonb;
