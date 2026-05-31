alter table public.rec_league_configuration
  add column if not exists stat_padding_rule_type text not null default 'cpu_only',
  add column if not exists custom_stat_padding_rule text;

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_stat_padding_rule_type_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_stat_padding_rule_type_check
  check (stat_padding_rule_type in ('on', 'cpu_only', 'off', 'custom'));

comment on column public.rec_league_configuration.stat_padding_rule_type is 'Controls REC stat padding rules: on, cpu_only, off, or custom.';
comment on column public.rec_league_configuration.custom_stat_padding_rule is 'Custom stat padding rule text when stat_padding_rule_type is custom.';
