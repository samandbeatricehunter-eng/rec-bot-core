-- Named, reusable draft boards a user can save once and reload for a future fantasy draft of
-- the same game — distinct from rec_fantasy_draft_board_entries, which is the single live
-- working board tied to one league's active draft session. Players are keyed primarily by
-- madden_player_id (stable across every league seeded from the same baseline dataset) so a
-- saved board can be resolved against a different league's pool; full_name/position are kept
-- as a display fallback for entries that never resolve (custom players, matching failures).

create table rec_fantasy_draft_saved_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references rec_users(id) on delete cascade,
  game text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game, name)
);
alter table rec_fantasy_draft_saved_boards enable row level security;

create table rec_fantasy_draft_saved_board_entries (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references rec_fantasy_draft_saved_boards(id) on delete cascade,
  rank integer not null,
  madden_player_id text,
  full_name text not null,
  position text not null
);
alter table rec_fantasy_draft_saved_board_entries enable row level security;
create index rec_fantasy_draft_saved_board_entries_board_id_idx on rec_fantasy_draft_saved_board_entries(board_id);
