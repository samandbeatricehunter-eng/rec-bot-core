-- Stores the team identity observed in the most recent import (city/nickname/abbreviation),
-- so custom/relocated team data can be compared against "what the league has" during advance.
alter table public.rec_teams
  add column if not exists import_city text,
  add column if not exists import_nick text,
  add column if not exists import_abbr text;
