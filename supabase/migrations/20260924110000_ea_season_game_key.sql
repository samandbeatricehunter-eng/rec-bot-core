-- The Companion App's own Force Win/Force Away Win/Clear Forced Result calls target a game
-- purely by {leagueId, seasonGameKey} -- no separate scheduleId/stageIndex/weekIndex fields at
-- all. Confirmed by decompiling the app's JS bundle (buildBlazeBody / ForceWin component).
-- Captured from EA's own schedule export going forward.
alter table public.rec_games add column if not exists ea_season_game_key text;

comment on column public.rec_games.ea_season_game_key is
  'EA''s own seasonGameKey for this game, from the schedule export. Required to target Force Win/Force Away Win/Clear Forced Result at this specific game via the Blaze API.';
