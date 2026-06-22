-- Which game a league is for (madden_26 | madden_27 | cfb_27), chosen at the
-- start of the League Setup wizard. Drives game-specific setup options later.
-- rec_leagues already has RLS enabled.
alter table public.rec_leagues
  add column if not exists game text not null default 'madden_26';
