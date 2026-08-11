-- Connect Companion entities to the same canonical tables used by manual and screenshot data.
create unique index if not exists rec_teams_league_madden_team_id_key
  on public.rec_teams(league_id, madden_team_id) where madden_team_id is not null;

alter table public.rec_player_weekly_stats
  add column if not exists source_type text,
  add column if not exists source_companion_record_id uuid references public.rec_madden_companion_records(id) on delete set null;
create unique index if not exists rec_player_weekly_stats_companion_record_key
  on public.rec_player_weekly_stats(source_companion_record_id)
  where source_companion_record_id is not null;

alter table public.rec_team_game_stats
  add column if not exists source_type text,
  add column if not exists source_external_id text,
  add column if not exists source_companion_record_id uuid references public.rec_madden_companion_records(id) on delete set null,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;
create unique index if not exists rec_team_game_stats_companion_record_key
  on public.rec_team_game_stats(source_companion_record_id)
  where source_companion_record_id is not null;
create index if not exists rec_team_game_stats_source_external_idx
  on public.rec_team_game_stats(league_id, source_external_id)
  where source_external_id is not null;

