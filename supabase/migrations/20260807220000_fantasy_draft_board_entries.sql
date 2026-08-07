-- Per-user fantasy draft big board (docs/madden-fantasy-draft-plan.md §5, "My Board").
-- Each league member keeps a personal ranked list of pool players (rank 1 = most wanted).
-- The list is private to its owner (no cross-user reads exposed by the API); the board
-- entries reference the league's own rec_players pool rows and are cleaned up when a
-- player is drafted (trigger below) or removed from the pool (rec_players FK cascade).

create table public.rec_fantasy_draft_board_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  player_id uuid not null references public.rec_players(id) on delete cascade,
  rank integer not null check (rank >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, league_id, player_id)
);
alter table public.rec_fantasy_draft_board_entries enable row level security;
create unique index rec_fantasy_draft_board_entries_rank_idx
  on public.rec_fantasy_draft_board_entries(user_id, league_id, rank);

-- Drafted players drop off every owner's board the moment the pick is logged. Undo does
-- NOT restore them (a pick is only undone to fix a logging mistake; the player is simply
-- missing from boards until an owner re-adds them).
create or replace function private.rec_remove_drafted_from_boards()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.rec_fantasy_draft_board_entries
  where player_id = new.player_id;
  return new;
end $$;

create trigger trg_fantasy_draft_pick_removes_board_entries
after insert on public.rec_fantasy_draft_picks
for each row execute function private.rec_remove_drafted_from_boards();

revoke all on function private.rec_remove_drafted_from_boards() from public, anon, authenticated;
