-- Field-discovery only, not used programmatically -- the Companion App's own Force Win reads
-- seasonGameKey from LeagueHub's gameScheduleHubInfo.leagueSchedule, a different response than
-- the WeeklySchedulesExport rec_games.ea_season_game_key was (wrongly) being sourced from.
alter table public.rec_ea_connections add column if not exists ea_game_schedule_hub_raw jsonb;

comment on column public.rec_ea_connections.ea_game_schedule_hub_raw is
  'Raw gameScheduleHubInfo from EA''s league hub response, captured on every import for field discovery -- not used programmatically.';
