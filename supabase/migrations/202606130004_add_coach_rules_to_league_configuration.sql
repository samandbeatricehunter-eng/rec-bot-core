alter table public.rec_league_configuration
  add column if not exists custom_coaches_required boolean not null default false,
  add column if not exists coach_abilities_restricted boolean not null default false,
  add column if not exists coach_abilities_restriction_notes text;
