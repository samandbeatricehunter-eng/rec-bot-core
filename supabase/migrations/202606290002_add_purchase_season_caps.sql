alter table public.rec_league_configuration
  add column if not exists custom_players_season_cap integer not null default 0,
  add column if not exists legends_season_cap integer not null default 0,
  add column if not exists dev_upgrades_season_cap integer not null default 0,
  add column if not exists age_resets_season_cap integer not null default 0,
  add column if not exists player_trait_purchases_season_cap integer not null default 0,
  add column if not exists contract_purchases_season_cap integer not null default 0,
  add column if not exists core_attribute_purchases_season_cap integer not null default 0,
  add column if not exists non_core_attribute_purchases_season_cap integer not null default 0,
  add column if not exists core_attributes jsonb not null default '[]'::jsonb;

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_custom_players_season_cap_check,
  drop constraint if exists rec_league_configuration_legends_season_cap_check,
  drop constraint if exists rec_league_configuration_dev_upgrades_season_cap_check,
  drop constraint if exists rec_league_configuration_age_resets_season_cap_check,
  drop constraint if exists rec_league_configuration_player_trait_purchases_season_cap_check,
  drop constraint if exists rec_league_configuration_contract_purchases_season_cap_check,
  drop constraint if exists rec_league_configuration_core_attribute_purchases_season_cap_check,
  drop constraint if exists rec_league_configuration_non_core_attribute_purchases_season_cap_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_custom_players_season_cap_check
    check (custom_players_season_cap between 0 and 5),
  add constraint rec_league_configuration_legends_season_cap_check
    check (legends_season_cap between 0 and 5),
  add constraint rec_league_configuration_dev_upgrades_season_cap_check
    check (dev_upgrades_season_cap between 0 and 5),
  add constraint rec_league_configuration_age_resets_season_cap_check
    check (age_resets_season_cap between 0 and 5),
  add constraint rec_league_configuration_player_trait_purchases_season_cap_check
    check (player_trait_purchases_season_cap between 0 and 10),
  add constraint rec_league_configuration_contract_purchases_season_cap_check
    check (contract_purchases_season_cap between 0 and 5),
  add constraint rec_league_configuration_core_attribute_purchases_season_cap_check
    check (core_attribute_purchases_season_cap between 0 and 20),
  add constraint rec_league_configuration_non_core_attribute_purchases_season_cap_check
    check (non_core_attribute_purchases_season_cap between 0 and 20);

comment on column public.rec_league_configuration.core_attributes is
  'Madden attribute codes (e.g. SPD, THP) designated as core for attribute purchase caps.';
