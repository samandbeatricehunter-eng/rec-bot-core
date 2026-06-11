create index if not exists idx_rec_player_weekly_stats_awards_lookup
on public.rec_player_weekly_stats (league_id, season_number, season_stage, stat_category);

create index if not exists idx_rec_game_results_regular_awards_lookup
on public.rec_game_results (league_id, season_number, is_playoff)
where is_playoff = false;
