-- Add fair sim and force win requirement text fields to league configuration.
alter table public.rec_league_configuration
  add column if not exists fair_sim_requirements text,
  add column if not exists force_win_requirements text;
