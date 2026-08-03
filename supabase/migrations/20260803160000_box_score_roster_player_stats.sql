-- Lets a box score submitter assign the applicable team-level stats (passing, rushing — never
-- team-aggregate fields like time of possession, penalties, or red zone %) from their just-
-- uploaded box score to a real roster player (rec_players), not just the free-text "watched
-- players" tracker rec_game_performance_tags already supports via watched_player_id.
alter table public.rec_game_performance_tags
  add column if not exists roster_player_id uuid references public.rec_players(id) on delete set null;

create index if not exists rec_game_performance_tags_roster_player_idx on public.rec_game_performance_tags(roster_player_id);
