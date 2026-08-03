alter table public.rec_league_configuration
  add column if not exists custom_rules jsonb not null default '[]'::jsonb;

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_custom_rules_shape_check;
alter table public.rec_league_configuration
  add constraint rec_league_configuration_custom_rules_shape_check
  check (jsonb_typeof(custom_rules)='array');
