-- Commissioner-selected division winners at the Week 18 -> Wild Card advance step.
-- rec_season_team_seeds already has RLS enabled; no new table is created here.

alter table public.rec_season_team_seeds
  add column if not exists division_name text,
  add column if not exists division_winner boolean not null default false;

create index if not exists idx_rec_season_team_seeds_division_winners
  on public.rec_season_team_seeds (league_id, season_number, conference, division_name)
  where division_winner = true;
