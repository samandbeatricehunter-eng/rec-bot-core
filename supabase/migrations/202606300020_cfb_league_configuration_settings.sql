-- CFB 27 dynasty settings for the league configuration.
-- Filterable columns power league discovery; cfb_settings jsonb holds the rest.
-- Columns are nullable (only populated for game = 'cfb_27' leagues); Madden rows leave them null.
alter table public.rec_league_configuration
  add column if not exists dynasty_type text,
  add column if not exists recruiting_difficulty text,
  add column if not exists transfer_portal_enabled boolean,
  add column if not exists coach_carousel_enabled boolean,
  add column if not exists conference_realignment text,
  add column if not exists home_field_advantage_enabled boolean,
  add column if not exists stadium_pulse_enabled boolean,
  add column if not exists team_builder_allowed boolean,
  add column if not exists cfb_settings jsonb not null default '{}'::jsonb;

-- Guard the enumerated columns so discovery filters can rely on a fixed set of values.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_dynasty_type_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_dynasty_type_check
      check (dynasty_type is null or dynasty_type in ('real', 'mixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_recruiting_difficulty_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_recruiting_difficulty_check
      check (recruiting_difficulty is null or recruiting_difficulty in ('easy', 'normal', 'hard'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_conference_realignment_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_conference_realignment_check
      check (conference_realignment is null or conference_realignment in ('allowed', 'locked'));
  end if;
end $$;

create index if not exists idx_rec_league_configuration_dynasty_type
  on public.rec_league_configuration (dynasty_type);
create index if not exists idx_rec_league_configuration_recruiting_difficulty
  on public.rec_league_configuration (recruiting_difficulty);
