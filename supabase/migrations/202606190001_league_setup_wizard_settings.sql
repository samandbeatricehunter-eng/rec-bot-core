alter table public.rec_league_configuration
  add column if not exists league_password text,
  add column if not exists attribute_purchases_enabled boolean not null default false,
  add column if not exists player_trait_purchases_enabled boolean not null default false,
  add column if not exists fourth_down_rule_type_regular text not null default 'standard_rec',
  add column if not exists fourth_down_rule_type_playoff text not null default 'standard_rec',
  add column if not exists custom_fourth_down_rule_regular text,
  add column if not exists custom_fourth_down_rule_playoff text,
  add column if not exists cpu_trading_policy text not null default 'allowed',
  add column if not exists cpu_trading_restriction text,
  add column if not exists difficulty_custom_settings text;

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_fourth_down_regular_check,
  drop constraint if exists rec_league_configuration_fourth_down_playoff_check,
  drop constraint if exists rec_league_configuration_cpu_trading_policy_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_fourth_down_regular_check
    check (fourth_down_rule_type_regular in ('none', 'standard_rec', 'custom')),
  add constraint rec_league_configuration_fourth_down_playoff_check
    check (fourth_down_rule_type_playoff in ('none', 'standard_rec', 'custom')),
  add constraint rec_league_configuration_cpu_trading_policy_check
    check (cpu_trading_policy in ('allowed', 'restricted', 'not_allowed'));

alter table public.rec_server_routes
  add column if not exists pending_purchases_channel_id text;

comment on column public.rec_league_configuration.league_password is
  'Optional Madden league password. Leave null for public leagues or leagues without a password.';
comment on column public.rec_league_configuration.attribute_purchases_enabled is
  'Enables economy purchases for player attribute upgrades.';
comment on column public.rec_league_configuration.player_trait_purchases_enabled is
  'Enables economy purchases for player trait changes.';
comment on column public.rec_league_configuration.cpu_trading_policy is
  'CPU trading setting selected during league setup: allowed, restricted, or not_allowed.';
comment on column public.rec_server_routes.pending_purchases_channel_id is
  'Discord channel for pending purchase review messages, separate from pending payout reviews.';
