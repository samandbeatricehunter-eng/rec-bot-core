-- EA's "teams" dataset already supplies each team's overall rating (ovrRating), fetched on every
-- import but never stored or used anywhere. Adding it so /openteams (and anything else) can show
-- it next to a team's name.
alter table public.rec_teams
  add column if not exists team_overall integer;
