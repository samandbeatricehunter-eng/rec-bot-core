-- Stable idempotency for manually entered schedule rows. The key includes the
-- league id in the value, but this index keeps the database guard local too.
create unique index if not exists rec_games_league_external_game_id_key
  on public.rec_games (league_id, external_game_id)
  where external_game_id is not null;

-- Prevent a team from being scheduled as away more than once in the same week.
create unique index if not exists rec_games_one_away_team_per_week_key
  on public.rec_games (league_id, season_number, week_number, away_team_id)
  where away_team_id is not null;

-- Prevent a team from being scheduled as home more than once in the same week.
create unique index if not exists rec_games_one_home_team_per_week_key
  on public.rec_games (league_id, season_number, week_number, home_team_id)
  where home_team_id is not null;
