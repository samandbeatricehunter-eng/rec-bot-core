-- All-time purchase caps were fully scaffolded (schema, League Setup UI, review display) but
-- never actually enforced anywhere in purchases.service.ts (only season caps were checked),
-- and the "open modal" button to set one was never wired to any screen — dead weight either
-- way. Decision: drop entirely, keep only season caps for every purchase type.
alter table public.rec_league_configuration
  drop column if exists custom_players_all_time_cap,
  drop column if exists legends_all_time_cap,
  drop column if exists dev_upgrades_all_time_cap,
  drop column if exists age_resets_all_time_cap,
  drop column if exists player_trait_purchases_all_time_cap,
  drop column if exists contract_purchases_all_time_cap,
  drop column if exists core_attribute_purchases_all_time_cap,
  drop column if exists non_core_attribute_purchases_all_time_cap;
