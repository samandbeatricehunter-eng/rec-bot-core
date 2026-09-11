-- Master Handoff Plan, Phase 1: verify route-channel source of truth.
-- Both columns have zero application code reading or writing them anywhere (economy_channel_id
-- was superseded by pending_economy_channel_id; game_of_week_channel_id was superseded by
-- posting GOTW content to the game's own game-channel, rec_game_channels.discord_channel_id).
-- Confirmed both are null for every row before dropping.

alter table public.rec_server_routes
  drop column if exists economy_channel_id,
  drop column if exists game_of_week_channel_id;
