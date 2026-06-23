alter table public.rec_league_configuration
  add column if not exists custom_players_all_time_cap integer,
  add column if not exists legends_all_time_cap integer,
  add column if not exists dev_upgrades_all_time_cap integer,
  add column if not exists age_resets_all_time_cap integer,
  add column if not exists player_trait_purchases_all_time_cap integer,
  add column if not exists contract_purchases_all_time_cap integer,
  add column if not exists core_attribute_purchases_all_time_cap integer,
  add column if not exists non_core_attribute_purchases_all_time_cap integer;

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_custom_players_all_time_cap_check,
  drop constraint if exists rec_league_configuration_legends_all_time_cap_check,
  drop constraint if exists rec_league_configuration_dev_upgrades_all_time_cap_check,
  drop constraint if exists rec_league_configuration_age_resets_all_time_cap_check,
  drop constraint if exists rec_league_configuration_player_trait_purchases_all_time_cap_check,
  drop constraint if exists rec_league_configuration_contract_purchases_all_time_cap_check,
  drop constraint if exists rec_league_configuration_core_attribute_purchases_all_time_cap_check,
  drop constraint if exists rec_league_configuration_non_core_attribute_purchases_all_time_cap_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_custom_players_all_time_cap_check
    check (custom_players_all_time_cap is null or custom_players_all_time_cap between 0 and 50),
  add constraint rec_league_configuration_legends_all_time_cap_check
    check (legends_all_time_cap is null or legends_all_time_cap between 0 and 50),
  add constraint rec_league_configuration_dev_upgrades_all_time_cap_check
    check (dev_upgrades_all_time_cap is null or dev_upgrades_all_time_cap between 0 and 50),
  add constraint rec_league_configuration_age_resets_all_time_cap_check
    check (age_resets_all_time_cap is null or age_resets_all_time_cap between 0 and 50),
  add constraint rec_league_configuration_player_trait_purchases_all_time_cap_check
    check (player_trait_purchases_all_time_cap is null or player_trait_purchases_all_time_cap between 0 and 50),
  add constraint rec_league_configuration_contract_purchases_all_time_cap_check
    check (contract_purchases_all_time_cap is null or contract_purchases_all_time_cap between 0 and 50),
  add constraint rec_league_configuration_core_attribute_purchases_all_time_cap_check
    check (core_attribute_purchases_all_time_cap is null or core_attribute_purchases_all_time_cap between 0 and 100),
  add constraint rec_league_configuration_non_core_attribute_purchases_all_time_cap_check
    check (non_core_attribute_purchases_all_time_cap is null or non_core_attribute_purchases_all_time_cap between 0 and 100);

comment on column public.rec_league_configuration.custom_players_all_time_cap is
  'League-scoped all-time purchase cap for custom players. Null means no all-time limit.';
comment on column public.rec_league_configuration.legends_all_time_cap is
  'League-scoped all-time purchase cap for legends. Null means no all-time limit.';
