-- Additional CFB 27 discovery/filter indexes for queryable league settings.
create index if not exists idx_rec_league_configuration_transfer_portal_enabled
  on public.rec_league_configuration (transfer_portal_enabled);

create index if not exists idx_rec_league_configuration_coach_carousel_enabled
  on public.rec_league_configuration (coach_carousel_enabled);

create index if not exists idx_rec_league_configuration_conference_realignment
  on public.rec_league_configuration (conference_realignment);

create index if not exists idx_rec_league_configuration_home_field_advantage_enabled
  on public.rec_league_configuration (home_field_advantage_enabled);

create index if not exists idx_rec_league_configuration_stadium_pulse_enabled
  on public.rec_league_configuration (stadium_pulse_enabled);

create index if not exists idx_rec_league_configuration_team_builder_allowed
  on public.rec_league_configuration (team_builder_allowed);

create index if not exists idx_rec_league_configuration_wear_and_tear_enabled
  on public.rec_league_configuration (wear_and_tear_enabled);
