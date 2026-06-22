-- Manual schedule uniqueness is scoped by rec_seasons.id, not a nonexistent season_number column.
drop index if exists public.rec_games_one_away_team_per_week_key;
drop index if exists public.rec_games_one_home_team_per_week_key;

create unique index if not exists rec_games_one_away_team_per_week_key
  on public.rec_games (league_id, season_id, week_number, away_team_id)
  where away_team_id is not null;

create unique index if not exists rec_games_one_home_team_per_week_key
  on public.rec_games (league_id, season_id, week_number, home_team_id)
  where home_team_id is not null;
