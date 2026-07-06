-- The 202606290001 migration dropped training_packages_enabled, cap_management_assistant_enabled,
-- draft_class_features_enabled, draft_class_type, and scouting_purchases_enabled from
-- rec_league_configuration, but this trigger function was never updated to stop referencing them.
-- Every insert/update to the table has been failing with "record new has no field
-- draft_class_features_enabled" ever since (latent until the next actual write hit the table).
create or replace function public.rec_enforce_league_configuration_dependencies()
returns trigger
language plpgsql
as $function$
begin
  if new.coin_economy_enabled = false then
    new.custom_players_enabled := false;
    new.legends_enabled := false;
    new.dev_upgrades_enabled := false;
    new.age_resets_enabled := false;
    new.contract_adjustment_purchases_enabled := false;
  end if;

  if new.salary_cap_enabled = false then
    new.contract_adjustment_purchases_enabled := false;
  end if;

  if new.coin_economy_minimum_linked_users < 8 then
    new.coin_economy_minimum_linked_users := 8;
  end if;

  if new.offensive_play_call_limits_enabled = false then
    new.offensive_play_call_limit := null;
  end if;

  if new.offensive_play_call_cooldown_enabled = false then
    new.offensive_play_call_cooldown := null;
  end if;

  if new.defensive_play_call_limits_enabled = false then
    new.defensive_play_call_limit := null;
  end if;

  if new.defensive_play_call_cooldown_enabled = false then
    new.defensive_play_call_cooldown := null;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;
