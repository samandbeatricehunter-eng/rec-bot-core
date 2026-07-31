-- Edit/delete support (spec §9.5) across all three chat tables. Deletes are soft (deleted_at
-- set, body left intact for audit) — list queries filter deleted_at is null, so deleted
-- messages simply stop appearing rather than needing tombstone rendering.
alter table public.rec_league_chat_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.rec_game_chat_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.rec_commissioner_chat_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;
