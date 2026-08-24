-- Field-discovery only, not used programmatically -- verifying the exact seasonGameKey field
-- name/type EA's schedule export actually sends (rec_games.ea_season_game_key came back null
-- after a real import) before relying on it for Force Win/Force Away Win/Clear Forced Result.
alter table public.rec_ea_connections add column if not exists ea_schedule_sample_raw jsonb;

comment on column public.rec_ea_connections.ea_schedule_sample_raw is
  'Raw sample row from EA''s schedule export, captured on every import for field discovery -- not used programmatically.';
