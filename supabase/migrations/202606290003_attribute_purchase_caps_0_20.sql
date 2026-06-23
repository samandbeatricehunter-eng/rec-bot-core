alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_core_attribute_purchases_season_cap_check,
  drop constraint if exists rec_league_configuration_non_core_attribute_purchases_season_cap_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_core_attribute_purchases_season_cap_check
    check (core_attribute_purchases_season_cap between 0 and 20),
  add constraint rec_league_configuration_non_core_attribute_purchases_season_cap_check
    check (non_core_attribute_purchases_season_cap between 0 and 20);
