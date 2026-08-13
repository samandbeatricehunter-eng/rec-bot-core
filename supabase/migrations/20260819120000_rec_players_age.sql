-- Persist in-game player age on the live roster row so store flows (age resets) can
-- show current age without joining snapshots. Companion exports and birth_year
-- backfill both populate this column.

alter table public.rec_players
  add column if not exists age integer;

comment on column public.rec_players.age is
  'In-game player age (Madden roster age). Age resets set this to 21.';

-- Approximate from birth_year where companion age was never stored.
update public.rec_players
   set age = greatest(18, least(45, 2026 - birth_year))
 where age is null
   and birth_year is not null
   and birth_year between 1975 and 2010;
