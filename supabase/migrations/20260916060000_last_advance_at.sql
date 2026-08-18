-- Records the timestamp the league's advance actually fired at (the previous next_advance_at,
-- captured right before it's cleared) so the Advance modal can default the new next-advance
-- time to "same time, next day" instead of leaving the field blank/optional.
alter table public.rec_leagues add column if not exists last_advance_at timestamptz;
alter table public.rec_leagues add column if not exists last_advance_timezone text;
