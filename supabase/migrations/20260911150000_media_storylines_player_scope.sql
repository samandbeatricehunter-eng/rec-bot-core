-- Fixes a scoping gap found during review of the Phase 1c claim-plan engine: rec_media_storylines
-- (added in 20260911140000_media_social_event_graph.sql) only scoped arcs by team_id/user_id, so
-- two different players on the same team both having a hot week would incorrectly merge into one
-- "player_breakout" storyline (whichever player touched it first would have every other player's
-- evidence appended under their name). Player-level story arcs need their own identity dimension,
-- and one that survives a trade (a breakout narrative should follow the player, not the roster
-- slot), so this adds player_id alongside the existing team_id/user_id scoping.
alter table public.rec_media_storylines
  add column if not exists player_id uuid references public.rec_players(id) on delete cascade;
create index if not exists rec_media_storylines_player_idx on public.rec_media_storylines (league_id, storyline_type, player_id);
