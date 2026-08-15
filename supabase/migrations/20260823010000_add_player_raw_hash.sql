-- Add raw_hash column to rec_players for hash-based import optimization.
-- Allows skipping database writes for players whose EA data hasn't changed since the last import.

alter table public.rec_players
  add column if not exists raw_hash text;

create index if not exists idx_rec_players_league_madden_hash
  on public.rec_players (league_id, madden_player_id, raw_hash)
  where madden_player_id is not null;
