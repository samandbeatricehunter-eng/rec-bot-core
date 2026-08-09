-- Fantasy-draft player cards show a player's Madden abilities. rec_players gains a jsonb
-- `abilities` column (array of { name, description }) populated from the baseline dataset's
-- abilities_raw blobs (parsed by apps/api/src/modules/madden-baseline/abilities.ts).
-- applyMaddenBaselineToLeague now fills it for newly applied leagues; rows seeded before
-- this migration are backfilled by apps/api/scripts/backfill-player-abilities.ts (the parse
-- lives in TS, not SQL). No RLS policies needed — service-role only, like every other
-- rec_players column.
alter table public.rec_players
  add column if not exists abilities jsonb;

comment on column public.rec_players.abilities is
  'Parsed Madden ability cards [{ name, description }] from the baseline abilities_raw blob.';
