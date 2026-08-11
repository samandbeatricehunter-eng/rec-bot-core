-- Companion aggregates are authoritative imports rather than box-score submissions.
-- Preserve the existing box-score uniqueness rule while allowing source-keyed imports.
alter table public.rec_team_game_stats
  alter column submission_id drop not null;

create unique index if not exists uq_rec_team_game_stats_companion_source
  on public.rec_team_game_stats (source_companion_record_id)
  where source_companion_record_id is not null;

create index if not exists idx_rec_player_weekly_stats_league_season_team
  on public.rec_player_weekly_stats (league_id, season_number, team_id, position);
