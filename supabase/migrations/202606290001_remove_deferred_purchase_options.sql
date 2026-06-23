-- Remove purchase options that were never exposed in league setup/settings.
alter table public.rec_league_configuration
  drop column if exists training_packages_enabled,
  drop column if exists cap_management_assistant_enabled,
  drop column if exists draft_class_features_enabled,
  drop column if exists draft_class_type,
  drop column if exists scouting_purchases_enabled;
