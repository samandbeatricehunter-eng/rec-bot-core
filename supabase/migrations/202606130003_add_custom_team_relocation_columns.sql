alter table public.rec_teams
  add column if not exists display_city text,
  add column if not exists display_nick text,
  add column if not exists display_abbr text,
  add column if not exists is_relocated boolean not null default false,
  add column if not exists original_abbreviation text;
