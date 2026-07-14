alter table public.rec_game_results
  add column if not exists game_id uuid references public.rec_games(id) on delete set null;

update public.rec_game_results result
set game_id = game.id
from public.rec_games game
where result.game_id is null
  and game.league_id = result.league_id
  and game.week_number = result.week_number
  and game.home_team_id = result.home_team_id
  and game.away_team_id = result.away_team_id
  and (
    game.season_id is null
    or result.season_number is null
    or exists (
      select 1
      from public.rec_seasons season
      where season.id = game.season_id
        and season.season_number = result.season_number
    )
  );

create index if not exists rec_game_results_game_id_idx
  on public.rec_game_results(game_id)
  where game_id is not null;
